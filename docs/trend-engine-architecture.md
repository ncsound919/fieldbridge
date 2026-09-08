# Deterministic Trend Engine — Architecture Blueprint

## Overview

A fully deterministic, autonomous trend-discovery system. Given the same corpus snapshot,
configuration, code version, and seeds, the engine produces byte-identical output. Every
insight is traceable through a hash-chained provenance chain back to raw source documents.

Design principles:
1. **Control plane is a pure function** — orchestration is a declared DAG, never model-driven.
2. **LLMs (optional) are tools, not orchestrators** — pinned model, temperature 0, prompt hashed
   into the run manifest. They may only produce scores or extractions, never routing decisions.
3. **Event-sourced, content-addressed stages** — every stage's output is stored by its content
   hash; a run is a Merkle tree of stage hashes.
4. **Replayability** — old corpora re-run against new engine versions in CI; insight ledger diffs
   are reviewed like code diffs.

---

## System Diagram

```
                        ┌────────────────────────────────────────────┐
                        │            DETERMINISTIC RUNNER            │
                        │  (DAG executor, stage hashing, checkpoints)│
                        └────────────────────────────────────────────┘
   │
   ▼
[1] INGESTION GRID ──► [2] NORMALIZER ──► [3] CORPUS STORE (content-addressed)
   search APIs             dedupe (simhash)     Supabase / Postgres
   scrapers                entity resolution    snapshot pinning
   RSS / HN / Reddit       language detect
   Wikipedia pageviews
   │
   ▼
[4] TREND ENGINE ────────────► [5] ANOMALY ENGINE
   STL decomposition             ±2σ/3σ remainder bands
   Kleinberg burst detection     changepoint (PELT / mosum)
   momentum + acceleration       volume/novelty outliers
   │                                   │
   └──────────────┬────────────────────┘
                  ▼
        [6] HYPOTHESIS ENGINE
        knowledge extraction → generation → screening → validation
        template-based, tournament scoring (no freeform LLM reasoning)
                  │
                  ▼
        [7] CROSS-DOMAIN ANALYSIS
        ontology graph traversal, lagged cross-correlation,
        co-occurrence matrices, shared-entity paths
                  │
                  ▼
        [8] POLYMATH INFERENCE ENGINE (abductive FSM)
        observation → hypothesis → plausibility → selection → refinement
                  │
                  ▼
        [9] DISCOVERY LEDGER (append-only, hash-chained)
        insight records with full provenance chains
```

---

## 1. Ingestion Grid

**Purpose:** Fan out over sources with a *rule-generated query plan*, not freeform search.

- Query plans compiled from config: seed topics × modifiers × source adapters.
- Every fetch logged: `{url, fetched_at, http_status, content_sha256}`.
- Rate limiting and retries are deterministic (fixed backoff schedule, seeded jitter).
- Snapshots pinned per run: a run references corpus snapshot ID, never "live" data.

**Source adapters (free-tier first):**
- Wikipedia Pageviews API (official, free, structured time series)
- Hacker News (Algolia API), Reddit JSON endpoints (respect ToS)
- GitHub trending / search API
- RSS feeds (curated list, versioned in config)
- arXiv API (for scientific domains)
- Search APIs: SerpApi / DataForSEO / Scraper APIs (paid, optional tier)
- Note: pytrends is archived/unmaintained (April 2025); Google Trends has no official API.
  If Trends data is required, use a scraping API tier or treat as best-effort source.

## 2. Normalizer

- Deduplication: SimHash / MinHash with fixed thresholds (versioned).
- Entity resolution: alias table + deterministic string canonicalization rules.
- Tokenization, stemming, NER (rule-based or pinned local model).
- Output: normalized document records keyed by content hash.

## 3. Corpus Store

- Supabase/Postgres. Tables: `documents`, `snapshots`, `stage_outputs`, `runs`, `insights`.
- `documents` PK = sha256 of normalized content.
- `snapshots` = immutable set of document hashes + ingestion manifest.
- Time-series projections: `series(doc_id | entity_id, metric, t, value)` for trend analysis.

## 4. Trend Engine

Deterministic detectors over the time-series projections:

- **STL decomposition** (statsmodels `STL(ts, period, robust=True)`): trend / seasonal /
  remainder components per entity series.
- **Kleinberg burst detection**: two-state automaton over document/mention frequency;
  outputs burst strength, burst start, burst end. Rank emerging vs. mature topics by
  burst recency + strength.
- **Momentum features**: week-over-week deltas, z-scored acceleration of trend component.
- All parameters (period, gamma, thresholds) live in versioned config — changing one
  changes the engine version, and re-runs are diffed.

## 5. Anomaly Engine

- ±2σ / ±3σ bands on STL remainder per series.
- Changepoint detection: PELT (Python `ruptures`) or moving-sum (mosum-style) on
  volume series.
- Novelty anomalies: entities/terms appearing with zero prior history but burst-class volume.
- Output: `anomaly(series_id, type, score, window, evidence_hash)`.
- Anomalies are the primary fuel for the hypothesis engine — each anomaly either
  resolves as a data artifact or escalates as a discovery candidate.

## 6. Hypothesis Engine

Three-stage pipeline (per autonomous-discovery literature):

1. **Knowledge extraction**: deterministic extraction of structured facts from corpus
   (templates + optional pinned LLM extraction with hash-verified output schema).
2. **Generation**: candidate hypotheses produced from a versioned template library
   applied to anomaly + trend context (e.g., "X is rising because correlated driver Y
   led it by k days in domain Z").
3. **Screening/validation**: tournament scoring on fixed criteria —
   evidential support, novelty, cross-domain confirmation, falsifiability, simplicity.
   Top-k advance; the rest are retained with scores for audit.

No hypothesis is stored without: originating anomaly IDs, supporting evidence hashes,
score breakdown, and engine version.

## 7. Cross-Domain Analysis

- **Ontology graph**: nodes = canonical entities/concepts, edges = typed relations
  (co-occurrence, causal-prior, taxonomic). Built deterministically from the corpus.
- **Lagged cross-correlation**: for each burst entity, search other domains' series for
  leading indicators (best lag + correlation, with significance thresholds).
- **Shared-entity paths**: graph traversal between a burst in domain A and established
  patterns in domain B; score by path length, edge weights, evidence density.

## 8. Polymath Inference Engine (Abductive FSM)

Finite-state machine, fully deterministic:

```
OBSERVE → HYPOTHESIZE → EVALUATE_PLAUSIBILITY → SELECT → REFINE → (loop, bounded)
```

- State transitions are rule-based; loop bounded by config (max iterations, min score
  delta for continuation).
- The FSM consumes anomaly/trend/hypothesis/cross-domain outputs only.
- "Polymath" behavior emerges from the ontology graph spanning many domains — the
  inference engine reasons over domain-agnostic graph structure, not domain-specific
  prompts.

## 9. Discovery Ledger

- Append-only table: `insights(id, created_run, hypothesis_id, confidence, provenance_root_hash, payload)`.
- Each record links to a provenance chain: insight → hypothesis → anomaly → series →
  documents → source fetches.
- Hash-chained: each insight record includes the hash of the previous record
  (tamper-evident audit trail).
- Insight ranking is a pure function of stored scores — dashboards never re-rank.

---

## Determinism Guarantees (Contract)

| Guarantee | Mechanism |
|---|---|
| Same input → same output | Pure-function stages, pinned corpus snapshots |
| Replayable runs | Run manifest: code version + config version + snapshot ID + seeds |
| Auditable insights | Hash-chained provenance from insight back to raw fetches |
| Non-LLM control flow | DAG runner with expression-based branching only |
| Pinned model behavior (optional LLM tools) | Model version + prompt hash in manifest; temperature 0; schema-validated output |
| Regression detection | CI re-runs historical snapshots against new engine versions; insight diffs reviewed |

---

## Data Model (Sketch)

```sql
documents    (sha256 PK, snapshot_id, source, url, fetched_at, content, metadata)
snapshots    (id PK, created_at, manifest_hash, document_count)
series       (id PK, entity_id, metric, granularity)
series_points(series_id, t, value)
stage_outputs(run_id, stage, input_hash, output_hash, payload)
runs         (id PK, engine_version, config_version, snapshot_id, started_at, status)
anomalies    (id PK, series_id, type, score, window_start, window_end, evidence_hash)
hypotheses   (id PK, anomaly_ids[], template_id, statement, scores jsonb, engine_version)
insights     (id PK, hypothesis_id, confidence, provenance_root, prev_insight_hash, payload, created_run)
```

---

## Stack

- **Runner/orchestration:** TypeScript DAG executor (or YAML-defined, Conductor-style)
- **Analysis:** Python (statsmodels STL, ruptures, scikit-learn), invoked as versioned stage images
- **Storage:** Supabase (Postgres) — documents, series, ledger
- **Jobs:** scheduled ingestion + nightly full runs; GitHub Actions cron (free tier)
- **UI/dashboard:** React + Vite, read-only over the ledger (insights, provenance explorer)
- **Optional LLM tier:** local model or pinned API model for extraction/scoring assist only

---

## Build Phases

### Phase 1 — Corpus + Spine (Weeks 1–3)
- [ ] DAG runner with stage hashing + checkpoint/resume
- [ ] Ingestion adapters: Wikipedia pageviews, HN, Reddit, RSS, arXiv
- [ ] Normalizer: dedup, entity canonicalization
- [ ] Snapshot pinning + run manifests
- Readiness score gate: replaying a snapshot twice yields identical stage hashes.

### Phase 2 — Trend + Anomaly (Weeks 4–6)
- [ ] Time-series projections per entity
- [ ] STL decomposition pipeline (versioned parameters)
- [ ] Kleinberg burst detection
- [ ] Remainder σ-bands + PELT changepoint detection
- [ ] Anomaly records with evidence hashes
- Gate: every anomaly reproducible from snapshot + config.

### Phase 3 — Hypothesis + Cross-Domain (Weeks 7–10)
- [ ] Ontology graph builder (entities + typed relations)
- [ ] Hypothesis template library + generation stage
- [ ] Tournament scoring (support, novelty, cross-domain confirmation, falsifiability)
- [ ] Lagged cross-correlation + shared-entity path analysis
- Gate: hypothesis scores deterministic; no stage output depends on wall-clock time
  except ingestion (which is snapshot-pinned).

### Phase 4 — Discovery Loop + Ledger (Weeks 11–13)
- [ ] Abductive FSM with bounded refinement loop
- [ ] Hash-chained insight ledger
- [ ] Provenance explorer UI
- [ ] CI replay job: historical snapshots vs. new engine versions, insight diff reports
- Gate: full autonomous cycle runs nightly; any insight answers
  "which documents and which code version produced this?"

---

## Failure Modes to Design Against

- **Source drift** (APIs change): adapters isolated per source; snapshot pinning means
  historical runs never break.
- **Config sprawl**: every parameter change bumps engine version; no silent tuning.
- **Ontology rot**: graph rebuilt per snapshot; versioned, never mutated in place.
- **Anomaly flooding**: score thresholds + per-window caps in config; dedup of
  near-identical anomalies by series-window hashing.
- **Hypothesis explosion**: tournament top-k selection; rejected hypotheses retained
  for audit but excluded from the ledger.
