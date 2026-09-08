# Rolling-Origin Benchmark Results (2026-09-08)

## Verdict: PENDING — NOT predictive yet

The engine may describe cross-disciplinary structure, but it has **not** earned
the word "predictive." This is the honest, pre-registered conclusion.

- Pre-registered success threshold: lower 95% CI of lift **> 1.10 on two
  consecutive held-out windows** (`src/lib/benchmark.ts`).
- Current state: **only one held-out window exists** in the 4-year snapshot
  (2014/2017/2020/2023), so the verdict is structurally PENDING — and even
  that window's CI does not clear the bar.

## Why the review's headline numbers were outdated

The review (2026-09) quoted `docs/phase3-results.md`, written before the
`densityNorm 0.2 → 0.4` calibration. The current `public/validation.json`
shows 2017→2023 lift of 1.29×, not 0.94×. The calibration genuinely fixed the
long-horizon no-lift finding on this snapshot. But the structural critique
survives: it is one snapshot, self-consistent, and the new benchmark below
shows the production score does not beat simple baselines.

## Rolling-origin results (primary threshold 1.0% cross-flow)

| window | tag | hit-rate | base-rate | lift | lift 95% CI |
|---|---|---|---|---|---|
| scored@2017 → 2020 | held-out | 0.50 | 0.46 | 1.09× | 0.62 .. 1.36 |
| scored@2020 → 2023 | calibration window | 0.75 | 0.61 | 1.23× | 0.87 .. 1.53 |

- Pooled held-out lift (1 window): **1.09×** — CI includes 1.0, so random
  selection cannot be rejected.
- The only window the engine was never fitted on (2017→2020) does not clear
  even the point-estimate bar, and its CI is wide enough to include "worse
  than random." Small sample (325 pairs, top-20) is the driver.

## Baselines — the production formula does NOT win

Held-out window (scored@2017 → 2020):

| baseline | lift |
|---|---|
| random | 1.20× |
| **highest-crossflow-growth (momentum)** | **1.20×** |
| highest-simgrowth / ablation-gap-only | 1.09× |
| full (engine) | 1.09× |
| field-size (ref-volume control) | 1.09× |
| lowest-crossflow / ablation-sim-only | 0.11× |

Calibration window (scored@2020 → 2023):

| baseline | lift |
|---|---|
| **highest-crossflow-growth** | **1.56×** |
| highest-simgrowth / ablation-gap-only | 1.32× |
| full (engine) | 1.23× |
| field-size | 1.07× |
| random | 0.91× |
| lowest-crossflow / ablation-sim-only | 0.08× |

## What this proves

1. **The citation-gap term adds no predictive value.** Removing it
   (`ablation-gap-only`, i.e. rank by keyword-sim growth alone) matches or
   beats the full engine on both windows. The gap signal is descriptive (it
   filters "interesting sparse pairs"), not a predictor of future bridging.
2. **Raw momentum beats the engine.** Highest recent cross-flow growth
   (1.20× / 1.56×) beats the dual-signal score (1.09× / 1.23×). Momentum is
   the strongest single predictor tested.
3. **Sparsity alone is anti-predictive.** Lowest-cross-flow and sim-only
   rank at 0.08–0.11× — the least sparse pairs bridge more. This validates
   the decision to require a second signal, but the second signal must not be
   the current one.
4. **At this sample size, lift is noisy.** Random selection (1.20×) beating
   the engine on the held-out window, and the engine's CI straddling 1.0,
   means 20-of-325 top-K hits are statistically weak. More held-out windows
   (fresh snapshot years via the nightly job) are the only cure.

## Formula implication (not copy, math)

The production formula `simGrowth × citationGap` should be re-examined.
Evidence points to a momentum+semantic hybrid (e.g. `simGrowth × momentum`)
outperforming `simGrowth × citationGap`. Re-run `npm run calibrate` and the
benchmark after any formula change; the benchmark verdict is the gate.

## Method notes

- `src/lib/benchmark.ts` — rolling-origin, frozen `ENGINE_CONFIG`, pair-level
  ground truth (cross-flow ≥ threshold at horizon), eligible-population base
  rate, deterministic seeded pair-resampling bootstrap (B=2000) for CIs.
- Baselines: random, lowest-crossflow, highest-simgrowth,
  highest-crossflow-growth, ablation-gap-only, ablation-sim-only,
  field-size (declared ref-volume control — sampled work counts are equal by
  construction and are NOT a size signal), and the full engine.
- Bridge threshold pre-registered at 1.0%, swept 0.5%/1%/2% for robustness
  (`public/benchmark.json`).
- ## Subfield-level benchmark (Phase 2): granularity confirmed, formula still loses

The literature hypothesis — prediction is dead at 26-field granularity (325
pairs) and viable at subfield granularity (~25k pairs) — was tested on our own
data: 228 OpenAlex subfields, 25,878 pairs, identical rolling-origin benchmark
with a scale-adjusted experiment config (`SUBFIELD_CONFIG`, own hash
`d6fee62f`; signal thresholds unchanged). Both windows are held-out (the
subfield config was never calibrated), so the verdict actually evaluates:
**FAIL** — but by the narrowest honest margin.

| window | engine lift | engine 95% CI | best baseline |
|---|---|---|---|
| scored@2017 → 2020 | 2.29× | 1.69 .. 3.25 (passes > 1.10) | momentum 3.82× |
| scored@2020 → 2023 | 1.59× | 0.98 .. 2.38 (misses) | momentum 3.52× |
| pooled | 1.89× | — | — |

Full subfield baselines (primary threshold 1.0%):

| baseline | 2017→2020 lift | 2020→2023 lift |
|---|---|---|
| **highest-crossflow-growth (momentum)** | **3.82×** | **3.52×** |
| highest-simgrowth / ablation-gap-only | 2.84× | 2.05× |
| full (engine) | 2.29× | 1.59× |
| field-size (ref-volume) | 1.20× | 1.82× |
| random | 1.31× | 1.02× |
| highest-diversity-growth | 0.66× | 0.68× |
| lowest-crossflow / ablation-sim-only | 0.11× | 0.11× |

Findings:
1. **Granularity hypothesis CONFIRMED.** Eligible pairs 150 → 1,130; the
   2017→2020 window PASSES the pre-registered threshold decisively (lower CI
   1.69 > 1.10). Pooled held-out lift 1.89×.
2. **Formula ranking UNCHANGED.** Momentum and semantic growth beat the
   dual-signal score on both windows, at both granularities. The
   citation-gap term adds no predictive lift (ablation-gap-only ≥ full).
3. **Diversity growth is anti-predictive** (0.66×/0.68×): pairs whose endpoint
   fields are diversifying are LESS likely to bridge. Canonical metrics
   describe; they do not forecast.
4. **Verdict FAIL is correct and narrow:** one window passes decisively, the
   second misses with lower CI 0.98 (just under 1.0). The trajectory is
   PENDING (field, underpowered) → FAIL-with-one-pass (subfield, powered).
   The gated next step is a formula revision (momentum × semantic evidence),
   re-run through `npm run benchmark:subfield` against fresh snapshot years.

Reproduce (field): `npm run benchmark -- --snapshot python/phase1/phase1_results.json --out public/benchmark.json`
Reproduce (subfield): `npm run benchmark:subfield -- --snapshot python/phase1/phase1_subfield_results.json --out public/subfield-benchmark.json`
- Config provenance enforced by `tests/provenance.test.ts` — any artifact
  whose config hash differs from `ENGINE_CONFIG` fails CI.