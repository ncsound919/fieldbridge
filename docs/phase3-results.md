# Phase 3 — Retrospective Validation + Gap Drilldown (2026-09-07)

## What shipped
- **Validation job** (`src/validate-run.ts`, `npm run validate`): scores pairs
  at each historical window (current year, previous year as sim baseline),
  surfaces top-K gaps, checks which bridged by the horizon year, and reports
  hit-rate **against base-rate** (random selection) with a threshold sweep.
  Outputs `public/validation.json`; rendered as the Validation panel.
- **Gap drilldown evidence** (in the artifact/dashboard): per surfaced gap —
  shared top keywords (current-year profiles) and bridge-paper count
  (distinct works in the sample citing across the pair).
- Integration test locking the validation composition (synthetic gap that
  bridges must beat random): 53 tests total.

## Live results (scored on the 2014/2017/2020/2023 snapshot)

| scored@ (prior) | horizon | threshold | hit-rate | base-rate | lift |
|---|---|---|---|---|---|
| 2017 (2014) | 2023 | 0.5% | 0.55 | 0.58 | 0.95× (no lift) |
| 2017 (2014) | 2023 | 1.0% | 0.40 | 0.43 | 0.94× (no lift) |
| **2020 (2017)** | 2023 | 0.5% | **0.75** | 0.58 | **1.30×** |
| **2020 (2017)** | 2023 | 1.0% | **0.50** | 0.43 | **1.17×** |
| 2023 (2020) | 2023 | 0.5% | 0.60 | 0.58 | 1.04× |
| 2023 (2020) | 2023 | 1.0% | 0.55 | 0.43 | 1.29× |

## Honest interpretation (do not tune)

- **Short-horizon prediction beats random** (2020-scored → 2023: 1.17–1.30×
  lift). The engine's recent gaps are directionally predictive of near-term
  cross-flow.
- **Long-horizon prediction does not** (2017-scored → 2023: 0.87–0.95×, i.e.
  at or below random). Six-year gap forecasts are not yet a credential — that
  is a finding, and the roadmap treats it as such rather than papering over it.
- "Bridged" is defined on **this snapshot's own horizon data** (cross-flow ≥
  threshold). External validation — new papers actually publishing and citing
  across the pair — accrues once the nightly job has accumulated fresh
  snapshots and is checked with the same harness.
- The base rate is high at 0.5% (58% of pairs "bridge"), so low thresholds are
  weak discriminators; the 1.0% column is the more meaningful reading.

## Pending (honest)
- **S2 embedding hidden-connection signal**: not built — no Semantic Scholar
  API key in Keywire. The keyword-drift signal stands in as the semantic half
  of the dual-signal rule. If an S2 key is added, the path is: sample distant
  pairs → SPECTER embeddings → pgvector (`field_embeddings` in
  supabase/schema.sql) → embedding-cosine as the semantic signal alongside
  keyword drift.
- **Calibration**: `minSimGrowth`/`minCitationGap`/`densityNorm` remain
  hand-set; the validation sweep is the first step toward data-driven
  calibration.

## Run
```bash
npm run validate -- --snapshot python/phase1/phase1_results.json --out public/validation.json
npm run artifact -- --snapshot python/phase1/phase1_results.json --out public/fieldbridge-matrix.json
npm run build
```