# Phase 1 — Full 26-Field Matrix + Dashboard (2026-09-07)

## What shipped
- **Pipeline** (`python/phase1/run.py`): all 26 OpenAlex fields × 2 years
  (2018 baseline, 2023 current), 150 works/field/year, references resolved in
  bounded stride-sampled subsets (1,000/field/year) with a credit cap.
- **Engine** (`src/lib/`, 43 tests): generalized to arbitrary field lists;
  coverage now measured over *attempted* refs so bounded resolution doesn't
  masquerade as poor data coverage.
- **Artifact builder** (`src/artifact.ts`): snapshot → dashboard JSON
  (flows, per-1k, coverage, keyword overlap, dual-signal gap leaderboard,
  run manifest).
- **Dashboard** (React + Vite): 26×26 citation-flow heatmap with coverage
  chips, pair drilldown, gap leaderboard + suppressed-pairs view, run
  manifest footer. `npm run dev`, `npm run build`.
- **Supabase schema** (`supabase/schema.sql`): field_pairs, gap_signals,
  validation_runs, run_manifests, pgvector — staged for the nightly pipeline.

## Live run
- Fields: 26 · Years: 2018, 2023 · Works: ~7,800
- OpenAlex spend: 1,145 / 10,000 daily credits (11.4%) per run — a nightly
  26-field sync fits the free tier at these parameters.
- Coverage: ~90–95% of attempted refs resolve.

## Gap leaderboard (dual-signal: sparse citation flow × converging keywords)
Top surfaced pairs (score = simGrowth × citationGap, both must clear
thresholds, coverage/size guards must pass):

| Pair | Score | citeGap | simGrowth |
|---|---|---|---|
| Earth & Planetary Sciences × Neuroscience | 0.624 | 0.996 | 0.627 |
| Earth & Planetary Sciences × Health Professions | 0.596 | 0.996 | 0.599 |
| Engineering × Neuroscience | 0.531 | 0.915 | 0.580 |
| Agricultural & Biological Sciences × Health Professions | 0.504 | 0.987 | 0.511 |
| Health Professions × Neuroscience | 0.502 | 0.954 | 0.527 |
| Health Professions × Mathematics | 0.429 | 0.980 | 0.438 |
| Medicine × Social Sciences | 0.380 | 0.825 | 0.461 |

These are believable (computational health, AI in medicine, geoscience × brain
science), not absurd — the first honest signal the engine produces. **They are
hypotheses, not claims:** nothing is validated against later ground truth yet
(that is the Phase 3 retrospective job).

## Method notes (honest)
- **Coverage semantics:** only attempted refs count toward coverage, so the
  1,000-ref cap does not create fake "data gaps." A ref that was looked up and
  missing (deleted/merged) counts against coverage as `null`.
- **Ref subsetting:** stride-sampled over sorted ref ids (deterministic,
  spread, no chronological prefix bias). Re-running with the corrected subset
  produced nearly identical top gaps — the conclusions are stable to the
  subset method.
- **Config thresholds** (`minSimGrowth`, `minCitationGap`, `densityNorm`) are
  still hand-set (calibrated to observed scale, not fitted to ground truth).
  They gate *what surfaces*, never what is *computed* — every pair is scored
  and the suppressed list is visible in the UI.
- **Field-level granularity caveat (from Phase 0):** V1 (Math most
  self-contained) does not reproduce at the 26-field level under this metric
  either — see docs/phase0-results.md. The dashboard does not claim it.

## Run
```bash
cd python/phase1 && python run.py --sample 150 --years 2018,2023   # ~1.1k credits
npm run artifact -- --snapshot python/phase1/phase1_results.json --out public/fieldbridge-matrix.json
npm run dev    # or npm run build && npx vite preview
```

---

## Phase 2 addition — 4-point trend axis (2026-09-07)

Re-ran at **2014 / 2017 / 2020 / 2023**, 120 works/field-year, 800 refs resolved
per field-year (1,873 credits). Gap scoring now uses the *previous* year as the
sim-growth baseline; `src/lib/trends.ts` adds closing/emerging ranking (tested).

**Fastest-closing gaps** (baseline-surfaced, cross-flow growth 2014→2023):

| Pair | closingRate | crossFlow (2023) |
|---|---|---|
| Computer Science × Medicine | 5.67 | 0.0565 |
| Engineering × Health Professions | 1.13 | 0.0187 |
| Earth & Planetary Sciences × Neuroscience | 1.10 | 0.0020 |
| Business, Management and Accounting × Medicine | 0.91 | 0.0114 |
| Engineering × Medicine | 0.68 | 0.0168 |

Computer Science × Medicine at 5.7× growth is the classic believable finding
(AI in medicine). These are trend *rankings from real data* — still hypotheses
until the retrospective-validation job (Phase 3) measures hit-rate against
later ground truth.

**Dashboard** now has a Trends panel (fastest-closing + emerging lists with
inline cross-flow sparklines) and per-pair series in the drilldown.
**Nightly job** staged at `.github/workflows/nightly.yml` (cron 03:15 UTC →
python ingest → artifact → commit); needs only an `OPENALEX_API_KEY` repo
secret.