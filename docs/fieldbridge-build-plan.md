# FieldBridge — Cross-Disciplinary Trend & Connection Engine

**Working name:** FieldBridge (alternatives: CrossWire, SparseEdge, Interstice)
**Owner:** Terrence Perry
**Stack:** React + Vite / TypeScript, Python workers, SQLite history, Supabase (upgrade path), GitHub Pages
**Budget rule:** Free-tier-first. $0/mo until proven value.

---

## 1. Vision

Turn the citation graph of all science into a live map of **where disciplines connect, where they don't, and which gaps are closing fastest**. The tool answers four questions no single-discipline search can:

1. **Correlation** — Which field pairs exchange citations, keywords, and authors, and how strongly?
2. **Trends** — Which cross-field links are growing fastest year over year?
3. **Hidden connections** — Which distant fields share methods/terminology without citing each other yet?
4. **Gaps** — Where is citation density near zero but semantic overlap rising? (These are pre-hybrid-field signals — the next bioinformatics.)

The core insight baked into the product: **the sparse region of the discipline×discipline matrix is the product.** Existing tools (bibliometrix, VOSviewer, PyblioNet) analyze a field you already know. FieldBridge analyzes the *space between* fields.

---

## 2. Data Sources (all free)

| Source | What you get | Free limits | Notes |
|---|---|---|---|
| **OpenAlex** (primary) | ~240M works, 2.5B citations, topics → fields → domains taxonomy, concepts, n-grams | Free key: $1/day usage (~100k credits/day), 100 req/s cap, cursor paging past 10k | CC0. Full snapshot on AWS S3 — no key needed for bulk download |
| **Semantic Scholar** (secondary) | ~200M papers, 2.4B citations, TLDRs, precomputed embeddings | Free key: ~1 RPS (1,000 req/5 min measured); unauthenticated is shared-pool and unreliable | Embeddings power the "hidden connection" engine |
| Crossref (optional) | DOI metadata, funding, references | Polite pool (mailto param): ~50 req/s | Fallback/reference enrichment |

**Strategy:** bulk-load field-pair citation counts from the OpenAlex S3 snapshot once, then keep live via daily API syncs. Never pay until a job demonstrably can't fit in 100k credits/day.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────┐
│  React + Vite dashboard (GitHub Pages)                │
│  • Discipline matrix heatmap (19 fields × 19)        │
│  • Force-directed citation-flow graph                │
│  • Gap radar: rising-similarity / low-citation pairs │
│  • Pair drilldown: shared keywords, bridge papers    │
└──────────────────────┬───────────────────────────────┘
                       │ reads
┌──────────────────────▼───────────────────────────────┐
│  Supabase (Postgres + pgvector + auth)               │
│  tables: works_cache, field_pairs, flow_snapshots,   │
│  gap_signals, saved_views, users                     │
└──────────────────────▲───────────────────────────────┘
                       │ writes
┌──────────────────────┴───────────────────────────────┐
│  Python workers (cron / GitHub Actions / Supabase    │
│  Edge Functions as orchestrators)                   │
│  1. ingest   — OpenAlex/S2 pulls, rate-limit aware   │
│  2. matrix   — build field×field citation flow table │
│  3. trends   — YoY growth, burst detection           │
│  4. hidden   — embedding similarity between distant  │
│                fields, keyword co-occurrence overlap │
│  5. gaps     — score pairs: sim↑ + citation↓ = gap   │
└──────────────────────────────────────────────────────┘
```

Deterministic by design: every metric is a pure function of stored data + versioned algorithm config. No LLM in the measurement path — LLMs (optional, later) only annotate *explanations* of detected gaps.

---

## 4. Data Model (core tables)

```sql
field_pairs (
  field_a text, field_b text,
  year int,
  citations_ab int,        -- a's papers cited by b
  citations_ba int,
  co_keyword_score float,  -- n-gram overlap (OpenAlex ngrams)
  embedding_sim float,     -- mean S2 embedding cosine sim (sampled)
  rao_stirling float,      -- cognitive distance metric
  primary key (field_a, field_b, year)
);

gap_signals (
  pair_id uuid, year int,
  gap_score float,         -- normalized(sim growth) × (1 - normalized(citation density))
  status text              -- 'emerging' | 'open' | 'bridged'
);

bridge_papers (
  work_id text, fields text[], score float, detected_at timestamptz
);
```

## 5. Algorithms

1. **Citation flow matrix** — count cross-field citations per year; normalize by field size (per-1k-papers) so Mathematics' small volume doesn't read as isolation artifact.
2. **Cognitive distance** — Rao-Stirling diversity across each field's citation profile (standard science-mapping metric, reproducible).
3. **Trend/burst detection** — Kleinberg burst algorithm or simple z-scored YoY log-growth on `field_pairs.citations_*`.
4. **Hidden connections** — two independent signals that must agree:
   - S2 embedding cosine similarity between sampled paper abstracts of distant fields, tracked over time;
   - keyword/n-gram co-occurrence drift (e.g., "graph neural network" appearing in chemistry abstracts).
5. **Gap score** — `norm(sim_growth) × (1 − norm(citation_density))`. Ranked list = product homepage.

---

## 6. Phased Roadmap

> Positioning (locked 2026-09, see docs/landscape.md §9): institutional buyer,
> transparency+validation moat. The following phases reflect that.

### Phase 0 — Validate the data (readiness gate, no UI) — DONE
- [x] Free OpenAlex key + S2 key obtained
- [x] Pull 5 years of works for 4 fields (Math, Biology, Sociology, Philosophy) via API
- [x] Compute one 4×4 flow matrix by hand in a notebook
- [x] Verify against a known link (Bio ↔ Chem strong) and a known gap (Math ↔ Humanities weak)
- [x] Deterministic compute core ported to tested TS (`src/lib/`), coverage +
      size normalization, dual-signal gap scoring, retrospective validation
      harness (all unit-tested, 42 tests)
- **Exit:** matrix matches published science-map intuition. ✅

### Phase 1 — Full matrix + static dashboard
- [ ] Ingest all 19 OpenAlex fields (or 4 domains first), 10-year window
- [ ] **Coverage normalization gate** — per-field coverage share stored with
      every flow; pairs below threshold flagged, never surfaced as gaps
- [x] Supabase schema + seed; React/Vite heatmap + graph view
- [x] Deploy to GitHub Pages, private
- **Exit:** you can see the sparse edges live, each labeled with its coverage
      caveat. ~1–2 weeks.

### Phase 2 — Trends
- [ ] Nightly ingest job (GitHub Actions cron → worker → Supabase)
- [ ] Growth/burst metrics; timeline scrubber on the heatmap
- [ ] "Fastest-closing gaps" leaderboard
- [ ] **Run manifests** stored per output (engine version + config hash +
      snapshot) so every leaderboard number is reproducible
- **Exit:** tool surfaces a trend you didn't already know. ~1–2 weeks.

### Phase 3 — Hidden connections + validation artifact
- [x] **Dual-signal gap score** (citation-gap × sim-growth, agreement required)
- [x] **Retrospective validation job** — re-score historical windows against
      later ground truth; publish hit-rate / precision@k **with base-rate**
      (docs/phase3-results.md)
- [x] Keyword drift detector (per-year keyword cosine series)
- [x] Gap drilldown: shared concepts, bridge papers, coverage caveat, trend series
- [ ] S2 embedding sampler for distant pairs; pgvector storage — **blocked:
      no Semantic Scholar API key in Keywire** (keyword-drift stands in as the
      semantic signal; see docs/phase3-results.md §Pending)
- **Exit:** gap score produces a believable, explorable discovery AND the
      published hit-rate that makes it institution-credible. Partially met:
      discovery + drilldown shipped; hit-rate published and honest (short
      horizon beats random, long horizon does not — unfudged).

### Phase 4 — Productize (institutional first)
- [ ] Auth + saved views (Supabase Auth)
- [ ] **Institutional analytics layer** — portfolio analysis, peer
      benchmarking, "emerging topic" reports; transparent methodology page
- [ ] Public shareable pair pages (SEO angle: "X × Y connection explorer")
- [ ] Alert subscriptions ("email me when Math↔Linguistics gap score crosses 0.7")
- [ ] Optional: LLM annotation layer for plain-English explanations (clearly
      labeled, never in the metric path)
- **Note:** consumer features are the free door; the institutional layer is
      the revenue path (landscape §5, §9).

---

## 7. Cost Ceiling (free tier)

| Layer | Free tier | Breakeven trigger |
|---|---|---|
| OpenAlex | ~10k credits/day | Snapshot bulk job replaces API pulls |
| Semantic Scholar | ~1 RPS with key | Sampling, not exhaustive pulls |
| Supabase | 500MB DB, 50k MAU | >400MB → archive old flow_snapshots |
| GitHub Pages | free static hosting | Custom domain when institutional rollout starts |
| GitHub Actions | 2,000 min/mo | Nightly jobs ≈ 30–60 min/day — fits |

Realistic run rate: **$0/mo** through Phase 3.

## 8. Differentiation

- **bibliometrix / VOSviewer / PyblioNet** — analyze a *known* field deeply; R/Java-centric, no gap-detection, no product UI. FieldBridge is web-native and starts from the *unknown* connections.
- **SciScope / Scopus-based tools** — paywalled data, institution-priced.
- **Nobody's product homepage is a ranked list of where science is about to connect.** That's the wedge.

## 9. Risks

- OpenAlex taxonomy churn (topics/fields re-clustered) → pin dataset version, store field IDs not just labels.
- Rate limits under load → all workers credit-aware with backoff; snapshot for bulk.
- "Hidden connection" false positives → require dual-signal agreement (embedding AND keyword drift) before surfacing.
- Cold-start credibility → ship Phase 0 validation notebook as public evidence.
