/**
 * Deterministic trend engine over per-year pair signals.
 *
 * Answers "which gaps are closing fastest" and "which are emerging" from a
 * time series of cross-flow and keyword-similarity signals. Pure functions of
 * stored per-year signals; no I/O, no wall-clock dependence. Any pair series
 * can be re-derived from snapshots + ENGINE_CONFIG.
 *
 * A "gap" here is a pair that was surfaced at the baseline period (sparse
 * citation flow + converging keywords). It is "closing" when its citation
 * cross-flow is growing across the window; it is "emerging" when its keyword
 * similarity is converging while cross-flow stays near zero.
 */

export interface PairSeries {
  a: string;
  b: string;
  /** Sorted-pair key ("a × b"). */
  pair: string;
  years: number[];
  /** Symmetric cross-flow share per period. */
  crossFlow: number[];
  /** Keyword-profile cosine per period. */
  kwSim: number[];
  /** Was the pair surfaced by gap scoring at the baseline period? */
  surfacedAtBaseline: boolean;
}

export interface ClosingGap {
  pair: string;
  a: string;
  b: string;
  /** Relative growth of cross-flow across the window (closing speed). */
  closingRate: number;
  /** Semantic convergence across the window. */
  kwSimGrowth: number;
  /** Current cross-flow (absolute density). */
  crossFlowCurrent: number;
  /** kwSim at the latest period. */
  kwSimCurrent: number;
}

export interface EmergingGap {
  pair: string;
  a: string;
  b: string;
  /** Semantic convergence while still sparse. */
  kwSimGrowth: number;
  /** Latest cross-flow (must remain low to be "emerging" not "bridged"). */
  crossFlowCurrent: number;
  /** Normalized emergence = kwSimGrowth * (1 - crossFlowCurrent/densityNorm). */
  emergenceScore: number;
}

/**
 * Directional convergence test (Buter/Noyons/van Raan 2010, quantitative
 * phase): a pair "converges" only when citation growth in BOTH directions is
 * statistically significant — a one-directional spike is a transfer, not a
 * convergence. Each direction is a two-proportion z-test on citation counts
 * (share x resolved refs), one-sided at the 5% level by default.
 */
export interface DirectionalGrowth {
  ab: number;
  ba: number;
  zAB: number;
  zBA: number;
  significantAB: boolean;
  significantBA: boolean;
  reciprocal: boolean;
}

export interface ConvergenceCounts {
  countAB: number;
  totalA: number;
  countBA: number;
  totalB: number;
  priorCountAB: number;
  priorTotalA: number;
  priorCountBA: number;
  priorTotalB: number;
}

export function convergenceTest(c: ConvergenceCounts, zCrit = 1.645): DirectionalGrowth {
  const dir = (
    cur: number, tot: number, prior: number, priorTot: number,
  ): { growth: number; z: number; significant: boolean } => {
    const p = tot > 0 ? cur / tot : 0;
    const pp = priorTot > 0 ? prior / priorTot : 0;
    const growth = p - pp;
    const se = Math.sqrt(
      (tot > 0 ? (p * (1 - p)) / tot : 0) + (priorTot > 0 ? (pp * (1 - pp)) / priorTot : 0),
    );
    const z = se > 0 ? growth / se : 0;
    return { growth, z, significant: growth > 0 && z >= zCrit };
  };
  const ab = dir(c.countAB, c.totalA, c.priorCountAB, c.priorTotalA);
  const ba = dir(c.countBA, c.totalB, c.priorCountBA, c.priorTotalB);
  return {
    ab: ab.growth,
    ba: ba.growth,
    zAB: ab.z,
    zBA: ba.z,
    significantAB: ab.significant,
    significantBA: ba.significant,
    reciprocal: ab.significant && ba.significant,
  };
}

export interface ConvergingPair {
  pair: string;
  a: string;
  b: string;
  growthAB: number;
  growthBA: number;
  zAB: number;
  zBA: number;
  reciprocal: boolean;
  /** min(zAB, zBA) — the weaker direction limits the claim. */
  convergenceStrength: number;
}

/**
 * Rank validated convergences: pairs surfaced at baseline whose citation
 * growth is significant in BOTH directions. Sorted by the weaker direction's
 * z-score (the claim is only as strong as its weaker half).
 */
export function convergingRank(
  series: PairSeries[],
  testByPair: Record<string, DirectionalGrowth>,
): ConvergingPair[] {
  return series
    .filter((s) => s.surfacedAtBaseline)
    .map((s) => {
      const t = testByPair[keyOf(s)] ?? {
        ab: 0, ba: 0, zAB: 0, zBA: 0,
        significantAB: false, significantBA: false, reciprocal: false,
      };
      return {
        pair: keyOf(s),
        a: s.a,
        b: s.b,
        growthAB: t.ab,
        growthBA: t.ba,
        zAB: t.zAB,
        zBA: t.zBA,
        reciprocal: t.reciprocal,
        convergenceStrength: Math.min(t.zAB, t.zBA),
      };
    })
    .filter((c) => c.reciprocal)
    .sort((x, y) => y.convergenceStrength - x.convergenceStrength);
}

/** Relative growth from first to last value; 0 if start is 0. */
export function relativeGrowth(values: number[]): number {
  if (values.length < 2) return 0;
  const start = values[0]!;
  const end = values[values.length - 1]!;
  if (start <= 0) return end > 0 ? 1 : 0;
  return (end - start) / start;
}

/**
 * Build per-pair series from per-year signal maps. Years are assumed sorted.
 */
export function buildPairSeries(
  years: number[],
  crossFlowByYear: Record<number, Record<string, number>>,
  kwSimByYear: Record<number, Record<string, number>>,
  surfacedAtBaseline: ReadonlySet<string>,
  pairs: Array<[string, string]>,
): PairSeries[] {
  return pairs.map(([a, b]) => {
    const key = [a, b].sort().join(" \u00d7 ");
    return {
      a,
      b,
      pair: key,
      years: [...years],
      crossFlow: years.map((y) => crossFlowByYear[y]?.[key] ?? 0),
      kwSim: years.map((y) => kwSimByYear[y]?.[key] ?? 0),
      surfacedAtBaseline: surfacedAtBaseline.has(key),
    };
  });
}

/**
 * Rank surfaced gaps by closing speed: how fast citation cross-flow is growing
 * across the window. Only pairs surfaced at baseline qualify.
 */
export function closingRank(series: PairSeries[]): ClosingGap[] {
  return series
    .filter((s) => s.surfacedAtBaseline)
    .map((s) => ({
      pair: keyOf(s),
      a: s.a,
      b: s.b,
      closingRate: relativeGrowth(s.crossFlow),
      kwSimGrowth: s.kwSim[0]! > 0 ? (s.kwSim[s.kwSim.length - 1]! - s.kwSim[0]!) / s.kwSim[0]! : 0,
      crossFlowCurrent: s.crossFlow[s.crossFlow.length - 1]!,
      kwSimCurrent: s.kwSim[s.kwSim.length - 1]!,
    }))
    .sort((x, y) => y.closingRate - x.closingRate);
}

/**
 * Rank emerging gaps: keyword convergence while cross-flow stays sparse.
 * Not gated on baseline surfacing (a pair can emerge mid-window); the
 * density guard prevents "bridged" pairs from being called emerging.
 */
export function emergingRank(
  series: PairSeries[],
  densityNorm: number,
): EmergingGap[] {
  return series
    .map((s) => {
      const kwSimGrowth = s.kwSim[0]! > 0 ? (s.kwSim[s.kwSim.length - 1]! - s.kwSim[0]!) / s.kwSim[0]! : 0;
      const crossFlowCurrent = s.crossFlow[s.crossFlow.length - 1]!;
      const sparsity = Math.max(0, Math.min(1, 1 - crossFlowCurrent / densityNorm));
      return {
        pair: keyOf(s),
        a: s.a,
        b: s.b,
        kwSimGrowth,
        crossFlowCurrent,
        emergenceScore: kwSimGrowth * sparsity,
      };
    })
    .filter((e) => e.crossFlowCurrent < densityNorm)
    .sort((x, y) => y.emergenceScore - x.emergenceScore);
}

function keyOf(s: { a: string; b: string }): string {
  return [s.a, s.b].sort().join(" \u00d7 ");
}