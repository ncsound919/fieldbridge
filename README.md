# FieldBridge

Cross-disciplinary trend & connection engine — maps **where disciplines
connect, where they don't, and which gaps are closing fastest**. The product
is the sparse region of the discipline×discipline matrix.

> **Claim honesty:** FieldBridge maps cross-disciplinary structure and
> generates evidence-backed hypotheses about emerging intersections. It does
> **not** yet claim to predict them — the rolling-origin benchmark
> (`docs/benchmark-results.md`, `public/benchmark.json`) is the gate, and it
> currently reads **PENDING**.

**Owner:** Terrence Perry · **Stack:** TypeScript + Vite (dashboard), Python
(workers), SQLite (durable history), Supabase (upgrade path), GitHub Pages
(deploy) · **Budget rule:** free-tier-first, $0/mo until proven value.

> Spec: `docs/fieldbridge-build-plan.md` (product), `docs/trend-engine-architecture.md` (deterministic trend engine).

## What's here (Phase 0 + Phase 1)

- `src/lib/` — the **deterministic compute core**, unit-tested TypeScript, no
  I/O: `abstractText`, `keywordCounts`, `cosine`, `buildFlowMatrix`,
  `validate`, plus the Phase-1 generalization to arbitrary field lists.
  - `config.ts` — versioned engine config + content hashing (provenance).
  - `matrix.ts` — flow matrix + **coverage & size normalization** (per-1k
    counts; coverage over *attempted* refs).
  - `gaps.ts` — **dual-signal gap scoring** (sparse citation flow × converging
    keywords, both required; low-coverage/small-field pairs suppressed).
  - `validation.ts` — **retrospective validation harness** (hit-rate /
    precision@k) — the institutional credibility artifact.
- `python/phase1/run.py` — full 26-field, 2-period OpenAlex ingestion with
  bounded stride-sampled resolution + credit cap (~1.1k credits/day run).
- `src/artifact.ts` — snapshot → dashboard artifact JSON (flows, coverage,
  gaps, manifest).
- `src/App.tsx` + `src/dashboard.css` — React/Vite dashboard: 26×26 heatmap,
  coverage chips, pair drilldown, gap leaderboard, suppressed-pairs view.
- `supabase/schema.sql` — Postgres schema (field_pairs, gap_signals,
  validation_runs, run_manifests, pgvector) — the upgrade path.
- `src/lib/sqlite-store.ts` — **SQLite history store** (`data/fieldbridge.db`):
  the durable, queryable record of every run's aggregates. Zero-ops, no cloud
  dependency; the Postgres schema mirrors it 1:1 for later migration.
- `src/lib/benchmark.ts` + `src/benchmark-run.ts` — **rolling-origin prediction
  benchmark** (held-out windows, explicit baselines, bootstrap CIs,
  pre-registered verdict). Output: `public/benchmark.json`.
  `src/subfield-run.ts` runs the same benchmark at OpenAlex subfield
  granularity (228 units, ~26k pairs) — output: `public/subfield-benchmark.json`.
- `src/lib/diversity.ts` — **canonical interdisciplinarity indices** (Rao-Stirling,
  Leydesdorff DIV with variety/balance/disparity components, Shannon, Simpson,
  Gini) + bootstrap CI for RS, per field per year in the artifact dashboard.
- `tests/` — vitest suite (94 tests), including config-provenance contract
  tests that fail CI when a published artifact's config hash differs from the
  runtime config (field or subfield experiment).
- `samples/selftest_snapshot.json` — synthetic fixture for running without API
  keys.
- `public/fieldbridge-matrix.json` — the latest computed artifact (from the
  live Phase 1 run; see `docs/phase1-results.md`).

## Run it

```bash
npm install
npm test          # 57 tests
npm run matrix -- --snapshot samples/selftest_snapshot.json

# real data (needs OpenAlex key, free):
export OPENALEX_API_KEY=...
export OPENALEX_EMAIL=you@example.com
cd python/phase1 && pip install -r requirements.txt
python run.py --sample 120 --years 2014,2017,2020,2023 --max-refs 800
npm run matrix -- --snapshot python/phase1/phase1_results.json
```

## Validation checks (Phase 0 exit gate)

- **V1** Mathematics has the highest within-field citation share.
- **V2** Math↔Philosophy flow < Biology↔Sociology flow.
- **V3** (exploratory) keyword overlap Math/Philosophy < Biology/Sociology.

Passing all three means the matrix matches published science-map intuition
(Boyack et al.). Sampling noise can flip borderline checks — re-run with
`--sample 1000` to confirm.

## Free-tier budget

OpenAlex: 10k credits/day free. Default nightly run = 26 fields × 4 years ×
120 works + bounded ref resolution under a 2500-credit cap; every run prints a
credit ledger.

## Deploy (GitHub Pages)

The site auto-deploys on every push to `main` via
`.github/workflows/deploy-pages.yml`. Enable once in the repo settings:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main` (or run the **Deploy to GitHub Pages** workflow manually).

`vite.config.ts` uses `base: "./"`, so assets resolve correctly at both
`/` and `/fieldbridge/`. The dashboard fetches `fieldbridge-matrix.json` and
`validation.json` from `public/` (tracked, rebuilt nightly by
`.github/workflows/nightly.yml`, which pushes to `main` and re-triggers the
deploy).

## Repo layout (target)

```
src/lib/        deterministic compute core (tested)
src/cli.ts      snapshot → matrix runner
src/App.tsx     React + Vite dashboard
python/phase0/  original 4-field OpenAlex worker
python/phase1/  26-field OpenAlex worker (nightly pipeline)
supabase/       schema + seed migrations (upgrade path)
```