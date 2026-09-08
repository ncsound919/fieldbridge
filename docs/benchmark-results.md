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
- Reproduce: `npm run benchmark -- --snapshot python/phase1/phase1_results.json --out public/benchmark.json`
- Config provenance enforced by `tests/provenance.test.ts` — any artifact
  whose config hash differs from `ENGINE_CONFIG` fails CI.