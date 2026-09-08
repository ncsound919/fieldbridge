# Calibration — Data-Driven Surfacing Thresholds (2026-09-07)

## What changed
`ENGINE_CONFIG.densityNorm` 0.2 → **0.4** (calibrated). `minCitationGap`
(0.7) and `minSimGrowth` (0.05) unchanged — the grid found them already right.

## Method (`src/calibrate.ts`, `npm run calibrate`)
- Grid: `densityNorm ∈ {0.1, 0.2, 0.4}` × `minCitationGap ∈ {0.6, 0.7, 0.8}` ×
  `minSimGrowth ∈ {0.02, 0.05, 0.1}` (27 candidates).
- Objective: mean lift (hit-rate / base-rate) on the **calibration window**
  scored@2020 (prior 2017) → horizon 2023, bridge thresholds 0.5% and 1.0%.
- **Held-out check:** the chosen config is also evaluated on scored@2017 →
  2023 — a window it was never fit against. A config that doesn't hold up
  out-of-window is rejected (the honest guard against overfitting).
- Qualification: a config must surface 5..40 gaps (a leaderboard that surfaces
  1 gap is not useful). Ties resolve toward the current defaults.

## Result (bridge threshold 1.0%)

| scored@ → horizon | lift before (0.2) | lift after (0.4) |
|---|---|---|
| 2017 → 2023 | 0.94× (no lift) | **1.29×** |
| 2020 → 2023 | 1.17× | **1.75×** |
| 2023 → 2023 | 1.29× | **1.64×** |

The calibration fixed a real weakness: the hand-tuned 0.2 did not beat random
on the long-horizon window; 0.4 does, and the improvement survives the
held-out check. All 9 validation windows now beat random.

## Honest caveats
- Fit on ONE snapshot's internal dynamics. The true test is fresh snapshots
  accumulating via the nightly job; re-run `npm run calibrate` as history
  grows and let the held-out check veto future threshold moves.
- 27 candidates on one calibration window is a small sample; the held-out
  check is the only guard, and it passed.
- The config hash changed (`a39716b0`), so every artifact/validation run now
  carries the calibrated config in its manifest — reproducibility intact.

## Run
```bash
npm run calibrate -- --snapshot python/phase1/phase1_results.json --out public/calibration.json
```