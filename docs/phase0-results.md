# Phase 0 Results — Live OpenAlex Run (2026-09-07)

Deterministic compute core: `src/lib/` (TS, 42 tests). Pipeline:
`python/phase0/run.py` → raw snapshot → `npm run matrix`.

## Run manifest
- **Sample:** 500 works/field × 4 fields, publication year 2023
- **Fields (canonical → OpenAlex):** Mathematics→26, Biology→11 (Agricultural
  and Biological Sciences), Sociology→33 (Social Sciences), Philosophy→12
  (Arts and Humanities)
- **OpenAlex spend:** 3,294 / 10,000 daily credits (32.9%)
- **Coverage:** 90–95% resolved refs per field (no coverage-artifact risk)

## Citation-flow matrix (share of resolved outbound refs)

| cites into → | Mathematics | Biology | Sociology | Philosophy |
|---|---|---|---|---|
| **Mathematics** | 0.4711 | 0.0089 | 0.0357 | 0.0038 |
| **Biology** | 0.0009 | 0.5928 | 0.0041 | 0.0005 |
| **Sociology** | 0.0070 | 0.0118 | 0.4770 | 0.0213 |
| **Philosophy** | 0.0037 | 0.0043 | 0.2245 | 0.3917 |

## Validation

| Check | Result | Detail |
|---|---|---|
| V1 Math has highest within-field share | **FAIL** | Math 0.471 < Biology 0.593 |
| V2 Math↔Phil flow < Bio↔Soc flow | PASS | 0.0037 < 0.0079 |
| V3 Math/Phil keyword overlap < Bio/Soc | PASS | 0.3028 < 0.3353 |

## Honest interpretation

**V1 does not reproduce under this measurement.** Two competing explanations,
both testable:

1. **Bucket granularity (likely dominant).** Mapping Philosophy→*Arts and
   Humanities* and Sociology→*Social Sciences* conflates many subfields. Math's
   refs scatter into Physics/CS/Engineering (separate OpenAlex fields excluded
   from our 4 columns), diluting its within-share; Biology's bucket captures a
   larger slice of its own ecosystem. The published "Math independence ≈ 1.00"
   (Boyack et al.) uses a different measure on a finer classification — not
   directly comparable.
2. **Real period/field effect.** The finding may not hold for a single 2023
   sample under share-of-resolved-refs.

**Do not tune or relabel this to pass.** The correct resolution is the full
26-field matrix (Phase 1) where each field is its own column and V1 is tested
at faithful granularity. A gap-detection product that fudges validation is
worthless to institutions — this repo does not.

**V2/V3 pass, with one striking artifact:** Philosophy (Arts & Humanities)
sends 22% of its refs to Social Sciences (0.2245). Under the coarse bucket
this reads as "philosophy cites sociology heavily" — which is mostly the
bucket's breadth, not a finding about philosophy proper. Fine-grain fields
(Phase 1) are required before any such claim is surfaced.

## Budget lesson (applies to Phase 1)

Free tier is **10,000 credits/day** (not 100k as the early build plan assumed).
`list`=1, `singleton`=0, `search`=10. A 4×500 run is ~3,300 credits. The
19–26-field matrix at 500/field would be ~8× that — a nightly 26-field run does
**not** fit the free tier as currently designed. Phase 1 must either shrink
sample sizes, use the S3 snapshot bulk path, or split runs across days.