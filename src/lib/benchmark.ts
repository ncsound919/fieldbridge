/**
 * Rolling-origin prediction benchmark + nontrivial baselines.
 *
 * This is the scientific-validity core. The product claim is honest only if
 * the engine's surfaced gaps beat simple, transparent alternatives on time
 * windows the engine was NOT fitted on. Everything here is a pure function of
 * (per-window pair signals, horizon ground truth, ENGINE_CONFIG).
 *
 * Design:
 *  - rolling-origin: for each scored year `current` (baseline `prior`),
 *    the horizon is the NEXT snapshot year `current + window`. Thresholds are
 *    frozen (ENGINE_CONFIG) before every window; nothing is re-fit per window.
 *  - per-window and pooled metrics (hit rate, base rate, lift, precision@k).
 *  - pair-resampling bootstrap (B draws, deterministic seed) → 95% CI for
 *    lift and hit-rate@K.
 *  - baselines the production score must beat:
 *      random, lowest cross-flow, highest kwSim growth, highest cross-flow
 *      growth, ablations (gap-only, sim-only), field-size control.
 *  - pre-registered success threshold: lower 95% CI of lift > 1.10 on two
 *    CONSECUTIVE held-out windows. PENDING (not FAIL) while fewer than two
 *    held-out windows exist.
 */

import type { EngineConfig } from "./config";
import { rankGaps, scorePairs, type GapScore, type PairSignals } from "./gaps";

export interface BenchmarkPair extends PairSignals {
  /** kwSim - kwSimPrior (unbounded). */
  simGrowth: number;
  /** crossFlow - crossFlowPrior (raw momentum). */
  crossFlowGrowth: number;
  /** Production dual-signal score. */
  score: number;
  /** Production surface flag (after suppression guards). */
  surfaced: boolean;
  /** Key = sorted "a × b". */
  pair: string;
  /**
   * Field-activity proxy (declared reference volume per field), used by the
   * field-size baseline. Sampled work counts are equal across fields by
   * construction, so they are NOT a size signal.
   */
  refVolume: [number, number];
}

export interface BenchmarkWindow {
  current: number;
  prior: number;
  horizon: number;
  /** Pair signals scored at `current` (with `prior` as baseline). */
  pairs: BenchmarkPair[];
  /** Ground truth: pair keys with cross-flow >= threshold at the horizon. */
  bridged: ReadonlySet<string>;
  /** True when this window was never used for calibration. */
  heldOut: boolean;
  /** True when this is the window calibration was fitted on. */
  calibrationWindow: boolean;
}

export interface ConfidenceInterval {
  lower: number;
  upper: number;
  mean: number;
  median: number;
}

export interface BaselineResult {
  name: string;
  surfaced: number;
  bridged: number;
  hitRate: number;
  baseRate: number;
  lift: number | null;
}

export interface WindowResult {
  current: number;
  prior: number;
  horizon: number;
  heldOut: boolean;
  calibrationWindow: boolean;
  eligible: number;
  surfaced: number;
  bridged: number;
  hitRate: number;
  baseRate: number;
  lift: number | null;
  precisionAtK: number[];
  liftCI: ConfidenceInterval | null;
  hitRateCI: ConfidenceInterval | null;
  baselines: BaselineResult[];
}

export interface BenchmarkResult {
  windows: WindowResult[];
  pooled: BaselineResult | null;
  successThreshold: { lowerCILift: number; consecutiveWindows: number };
  verdict: { passed: boolean; state: "PASS" | "FAIL" | "PENDING"; reason: string };
  config: EngineConfig;
}

export type BaselineName =
  | "random"
  | "lowest-crossflow"
  | "highest-simgrowth"
  | "highest-crossflow-growth"
  | "ablation-gap-only"
  | "ablation-sim-only"
  | "field-size"
  | "full";

const RANKERS: Record<Exclude<BaselineName, "random" | "full">, (p: BenchmarkPair) => number> = {
  "lowest-crossflow": (p) => -p.crossFlow,
  "highest-simgrowth": (p) => p.simGrowth,
  "highest-crossflow-growth": (p) => p.crossFlowGrowth,
  "ablation-gap-only": (p) => p.simGrowth,
  "ablation-sim-only": (p) => 1 - p.crossFlow / 0.4,
  "field-size": (p) => p.refVolume[0] * p.refVolume[1],
};

export function buildBenchmarkPairs(
  signals: PairSignals[],
  cfg: EngineConfig,
  refVolumeOf?: (f: string) => number,
): BenchmarkPair[] {
  return signals.map((s) => {
    const gap = scorePairs([s], cfg)[0]!;
    const priorCross = s.crossFlowPrior ?? s.crossFlow;
    return {
      ...s,
      simGrowth: s.kwSim - s.kwSimPrior,
      crossFlowGrowth: s.crossFlow - priorCross,
      score: gap.score,
      surfaced: gap.surfaced,
      pair: gap.pair,
      refVolume: refVolumeOf ? [refVolumeOf(s.a), refVolumeOf(s.b)] : s.sizes,
    };
  });
}

/**
 * Top-K pair keys per baseline strategy. `full` uses the production surfaced
 * set ranked by score; others rank the eligible (unsuppressed) population.
 */
export function baselineRankings(
  pairs: BenchmarkPair[],
  cfg: EngineConfig,
  topK: number,
): Record<BaselineName, string[]> {
  const eligible = pairs.filter((p) => p.surfaced);
  const fullScores: GapScore[] = eligible.map((p) => ({
    pair: p.pair,
    score: p.score,
    citationGap: 0,
    simGrowth: 0,
    dualAgree: true,
    surfaced: true,
    suppressedFor: [],
    crossFlow: p.crossFlow,
    kwSim: p.kwSim,
    kwSimPrior: p.kwSimPrior,
  }));
  const out = {
    random: seededShuffle(eligible.map((p) => p.pair), 0xfb).slice(0, topK),
    full: rankGaps(fullScores, topK).map((g) => g.pair),
  } as Record<BaselineName, string[]>;
  for (const [name, key] of Object.entries(RANKERS) as Array<[Exclude<BaselineName, "random" | "full">, (p: BenchmarkPair) => number]>) {
    out[name] = [...eligible].sort((x, y) => key(y) - key(x)).slice(0, topK).map((p) => p.pair);
  }
  return out;
}

/**
 * Pair-resampling bootstrap: resample the eligible pair population with
 * replacement B times, recompute top-K hit rate / base rate / lift each draw.
 * Deterministic (seeded). Returns percentile CIs.
 */
export function pairBootstrapLift(
  pairs: BenchmarkPair[],
  bridged: ReadonlySet<string>,
  topK: number,
  options: { b?: number; seed?: number } = {},
): { lift: ConfidenceInterval; hitRate: ConfidenceInterval } {
  const b = options.b ?? 2000;
  const rnd = mulberry32(options.seed ?? 0xfb);
  const eligible = pairs.filter((p) => p.surfaced);
  const n = eligible.length;
  if (n === 0 || topK === 0) {
    const empty = { lower: 0, upper: 0, mean: 0, median: 0 };
    return { lift: empty, hitRate: empty };
  }
  const lifts: number[] = [];
  const hits: number[] = [];
  for (let it = 0; it < b; it++) {
    const sample: BenchmarkPair[] = [];
    for (let i = 0; i < n; i++) sample.push(eligible[Math.floor(rnd() * n)]!);
    const ranked = [...sample].sort((x, y) => y.score - x.score).slice(0, topK);
    const hit = ranked.filter((p) => bridged.has(p.pair)).length;
    const base = sample.filter((p) => bridged.has(p.pair)).length / n;
    const hr = hit / topK;
    lifts.push(base > 0 ? hr / base : 0);
    hits.push(hr);
  }
  lifts.sort((a, c) => a - c);
  hits.sort((a, c) => a - c);
  return {
    lift: ciOf(lifts, b),
    hitRate: ciOf(hits, b),
  };
}

/** Evaluate one rolling-origin window across all baselines. */
export function benchmarkWindow(
  w: BenchmarkWindow,
  cfg: EngineConfig,
  topK: number,
  bootstrapSeed = 0xfb,
): WindowResult {
  const rankings = baselineRankings(w.pairs, cfg, topK);
  const eligible = w.pairs.filter((p) => p.surfaced);
  const baseRate = eligible.length > 0 ? eligible.filter((p) => bridged(p.pair, w)).length / eligible.length : 0;
  const fullKeys = rankings.full;

  const evaluate = (keys: string[]): BaselineResult => {
    const bridgedCount = keys.filter((k) => bridged(k, w)).length;
    const hitRate = keys.length > 0 ? bridgedCount / keys.length : 0;
    return {
      name: "",
      surfaced: keys.length,
      bridged: bridgedCount,
      hitRate: round4(hitRate),
      baseRate: round4(baseRate),
      lift: baseRate > 0 ? round4(hitRate / baseRate) : null,
    };
  };

  const full = evaluate(fullKeys);
  const baselines: BaselineResult[] = [];
  for (const name of Object.keys(rankings) as BaselineName[]) {
    if (name === "full") continue;
    baselines.push({ ...evaluate(rankings[name]), name });
  }
  baselines.push({ ...full, name: "full" });

  const boot = pairBootstrapLift(w.pairs, w.bridged, topK, { seed: bootstrapSeed });

  const precisionAtK: number[] = [];
  let hits = 0;
  fullKeys.forEach((k, i) => {
    if (bridged(k, w)) hits += 1;
    precisionAtK.push(round4(hits / (i + 1)));
  });

  return {
    current: w.current,
    prior: w.prior,
    horizon: w.horizon,
    heldOut: w.heldOut,
    calibrationWindow: w.calibrationWindow,
    eligible: eligible.length,
    surfaced: fullKeys.length,
    bridged: full.bridged,
    hitRate: full.hitRate,
    baseRate: full.baseRate,
    lift: full.lift,
    precisionAtK,
    liftCI: boot.lift,
    hitRateCI: boot.hitRate,
    baselines,
  };
}

export function rollingOriginBenchmark(
  windows: BenchmarkWindow[],
  cfg: EngineConfig,
  topK: number,
): BenchmarkResult {
  const results = windows.map((w) => benchmarkWindow(w, cfg, topK));

  // Pooled over held-out windows only (the windows the engine was never
  // fitted on). Nothing to claim about pooled in-sample lift.
  const heldOutWindows = windows.filter((w) => w.heldOut);
  const pooled: BaselineResult | null = (() => {
    if (heldOutWindows.length === 0) return null;
    const surfacedKeys = new Set<string>();
    let bridgedCount = 0;
    const eligibleKeys = new Set<string>();
    let eligibleBridged = 0;
    for (const w of heldOutWindows) {
      const keys = baselineRankings(w.pairs, cfg, topK).full;
      for (const k of keys) {
        surfacedKeys.add(k);
        if (w.bridged.has(k)) bridgedCount += 1;
      }
      for (const p of w.pairs.filter((p) => p.surfaced)) {
        eligibleKeys.add(p.pair);
        if (w.bridged.has(p.pair)) eligibleBridged += 1;
      }
    }
    const baseRate = eligibleKeys.size > 0 ? eligibleBridged / eligibleKeys.size : 0;
    const hitRate = surfacedKeys.size > 0 ? bridgedCount / surfacedKeys.size : 0;
    return {
      name: "pooled-held-out",
      surfaced: surfacedKeys.size,
      bridged: bridgedCount,
      hitRate: round4(hitRate),
      baseRate: round4(baseRate),
      lift: baseRate > 0 ? round4(hitRate / baseRate) : null,
    };
  })();

  const successThreshold = { lowerCILift: 1.1, consecutiveWindows: 2 };
  const heldOutResults = results.filter((r) => r.heldOut);
  const qualifying = heldOutResults.filter((r) => r.liftCI !== null && r.liftCI.lower > successThreshold.lowerCILift);
  const consecutive = maxConsecutive(qualifying.map((r) => r.current).sort((a, b) => a - b));
  const state = heldOutResults.length < successThreshold.consecutiveWindows ? "PENDING" : consecutive >= successThreshold.consecutiveWindows ? "PASS" : "FAIL";
  const reason =
    state === "PENDING"
      ? `only ${heldOutResults.length} held-out window(s) exist; ${successThreshold.consecutiveWindows} consecutive held-out windows required before a predictive claim`
      : state === "PASS"
        ? `lower 95% CI of lift > ${successThreshold.lowerCILift} on ${consecutive} consecutive held-out windows`
        : `lower 95% CI of lift <= ${successThreshold.lowerCILift} on held-out windows (max run ${consecutive})`;

  return {
    windows: results,
    pooled,
    successThreshold,
    verdict: { passed: state === "PASS", state, reason },
    config: cfg,
  };
}

function bridged(key: string, w: BenchmarkWindow): boolean {
  return w.bridged.has(key);
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const rnd = mulberry32(seed);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ciOf(sorted: number[], b: number): ConfidenceInterval {
  if (sorted.length === 0) return { lower: 0, upper: 0, mean: 0, median: 0 };
  const lo = sorted[Math.floor(b * 0.025)] ?? sorted[0]!;
  const hi = sorted[Math.min(sorted.length - 1, Math.ceil(b * 0.975))] ?? sorted[sorted.length - 1]!;
  const mean = sorted.reduce((s, x) => s + x, 0) / sorted.length;
  const med = sorted[Math.floor(sorted.length / 2)] ?? sorted[0]!;
  return { lower: round4(lo), upper: round4(hi), mean: round4(mean), median: round4(med) };
}

function maxConsecutive(sortedYears: number[]): number {
  if (sortedYears.length === 0) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < sortedYears.length; i++) {
    run = sortedYears[i]! - sortedYears[i - 1]! <= 4 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}