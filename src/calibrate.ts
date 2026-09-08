/**
 * FieldBridge — surfacing-threshold calibration.
 *
 * Turns hand-tuned ENGINE_CONFIG thresholds into data-calibrated ones, using
 * the retrospective-validation harness as the objective function. To avoid
 * calibrating and evaluating on the same window, we use a leave-one-window-out
 * split:
 *
 *   calibration window: scored@2020 (prior 2017) -> horizon 2023
 *   held-out window:    scored@2017 (prior 2014) -> horizon 2023
 *
 * The best config is chosen on the calibration window's lift (hit-rate vs
 * base-rate at a fixed bridging threshold) and then reported against the
 * held-out window. If the chosen config does not hold up out-of-window, that
 * is the honest result — thresholds stay near their current values rather
 * than chasing noise.
 *
 * Guards against degenerate winners: a config must surface a usable number of
 * gaps (5..40) to qualify, and near-equal scores resolve toward the current
 * defaults (regularization, not data-fishing).
 *
 * Usage:
 *   npm run calibrate -- --snapshot python/phase1/phase1_results.json --out public/calibration.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  ENGINE_CONFIG,
  abstractText,
  allPairs,
  buildFlowMatrix,
  cosine,
  hashObject,
  keywordCounts,
  rankGaps,
  retrospectiveValidate,
  scorePairs,
  type EngineConfig,
  type Work,
} from "./lib/index.js";

interface SnapshotV2 {
  meta: { fields: string[]; years: number[] };
  works: Record<string, Record<string, Work[]>>;
  cited_fields: Record<string, string | null>;
}

const args = process.argv.slice(2);
const snapshotArg = args.find((a, i) => args[i - 1] === "--snapshot") ?? args[0];
const outPath = args.find((a, i) => args[i - 1] === "--out") ?? "public/calibration.json";

if (!snapshotArg) {
  console.error("usage: npm run calibrate -- --snapshot <snapshot.json> [--out <calibration.json>]");
  process.exit(1);
}

const snap = JSON.parse(readFileSync(snapshotArg, "utf8")) as SnapshotV2;
const fields = snap.meta.fields;
const years = snap.meta.years;
const cache = new Map(Object.entries(snap.cited_fields)) as Map<string, string | null>;

function yearState(year: number) {
  const worksByField: Record<string, Work[]> = {};
  const sizes: Record<string, number> = {};
  const kws: Record<string, Record<string, number>> = {};
  for (const f of fields) {
    const works = snap.works[f]?.[String(year)] ?? [];
    worksByField[f] = works;
    sizes[f] = works.length;
    kws[f] = keywordCounts(works.map((w) => abstractText(w.abstract_inverted_index)));
  }
  return { flows: buildFlowMatrix(worksByField, cache, fields), kws, sizes };
}

const states = new Map<number, ReturnType<typeof yearState>>();
for (const y of years) states.set(y, yearState(y));

const TOP_K = ENGINE_CONFIG.topK;
const BRIDGE_THRESHOLDS = [0.005, 0.01];
const QUALIFY = { minSurfaced: 5, maxSurfaced: 40 };

const grid = {
  densityNorm: [0.1, 0.2, 0.4],
  minCitationGap: [0.6, 0.7, 0.8],
  minSimGrowth: [0.02, 0.05, 0.1],
};

/** Lift (hit-rate / base-rate) for one scored window at one bridge threshold. */
function liftFor(
  cfg: EngineConfig,
  current: number,
  prior: number,
  horizon: number,
  threshold: number,
): { lift: number; hitRate: number; baseRate: number; surfaced: string[]; bridgedCount: number } {
  const cur = states.get(current)!;
  const pr = states.get(prior)!;
  const pairs = allPairs(fields).map(([a, b]) => {
    const key = [a, b].sort().join(" \u00d7 ");
    return {
      a,
      b,
      crossFlow: ((cur.flows[a]?.[b] ?? 0) + (cur.flows[b]?.[a] ?? 0)) / 2,
      kwSim: cosine(cur.kws[a]!, cur.kws[b]!),
      kwSimPrior: cosine(pr.kws[a]!, pr.kws[b]!),
      coverage: [coverageOf(cur, a), coverageOf(cur, b)] as [number, number],
      sizes: [cur.sizes[a] ?? 0, cur.sizes[b] ?? 0] as [number, number],
    };
  });
  const scored = scorePairs(pairs, cfg);
  const surfaced = rankGaps(scored, TOP_K).map((g) => g.pair);
  const horizonState = states.get(horizon)!;
  const bridged = new Set(
    allPairs(fields)
      .map(([a, b]) => {
        const key = [a, b].sort().join(" \u00d7 ");
        const cross = ((horizonState.flows[a]?.[b] ?? 0) + (horizonState.flows[b]?.[a] ?? 0)) / 2;
        return cross >= threshold ? key : null;
      })
      .filter((k): k is string => k !== null),
  );
  const res = retrospectiveValidate([{ year: current, surfaced, scored: scored.map((g) => g.pair) }], bridged, TOP_K);
  const baseRate = allPairs(fields).length > 0 ? bridged.size / allPairs(fields).length : 0;
  return {
    lift: baseRate > 0 ? res.hitRate / baseRate : null as unknown as number,
    hitRate: res.hitRate,
    baseRate,
    surfaced,
    bridgedCount: res.bridgedCount,
  };
}

interface CandidateResult {
  densityNorm: number;
  minCitationGap: number;
  minSimGrowth: number;
  calibLift: number;
  calibHitRate: number;
  calibSurfaced: number;
  heldOutLift: number | null;
  heldOutHitRate: number;
}

const calibCurrent = 2020;
const calibPrior = 2017;
const heldCurrent = 2017;
const heldPrior = 2014;
const horizon = 2023;

const results: CandidateResult[] = [];
for (const densityNorm of grid.densityNorm) {
  for (const minCitationGap of grid.minCitationGap) {
    for (const minSimGrowth of grid.minSimGrowth) {
      const cfg: EngineConfig = { ...ENGINE_CONFIG, densityNorm, minCitationGap, minSimGrowth };
      const lifts = BRIDGE_THRESHOLDS.map((t) => liftFor(cfg, calibCurrent, calibPrior, horizon, t));
      const nSurfaced = lifts[0]!.surfaced.length;
      if (nSurfaced < QUALIFY.minSurfaced || nSurfaced > QUALIFY.maxSurfaced) continue;
      const calibLift = lifts.reduce((s, l) => s + l.lift, 0) / lifts.length;
      const held = liftFor(cfg, heldCurrent, heldPrior, horizon, BRIDGE_THRESHOLDS[1]!);
      results.push({
        densityNorm,
        minCitationGap,
        minSimGrowth,
        calibLift: round4(calibLift),
        calibHitRate: round4(lifts[1]!.hitRate),
        calibSurfaced: nSurfaced,
        heldOutLift: round4(held.lift),
        heldOutHitRate: round4(held.hitRate),
      });
    }
  }
}

// Best by calibration lift; ties break toward the current defaults.
const best = [...results].sort((a, b) => {
  const d = b.calibLift - a.calibLift;
  if (Math.abs(d) > 0.02) return d;
  return distFromDefaults(a) - distFromDefaults(b);
})[0];

const recommended: EngineConfig = best
  ? { ...ENGINE_CONFIG, densityNorm: best.densityNorm, minCitationGap: best.minCitationGap, minSimGrowth: best.minSimGrowth }
  : ENGINE_CONFIG;

const output = {
  manifest: {
    engine: `fieldbridge@${ENGINE_CONFIG.version}`,
    configHash: hashObject(ENGINE_CONFIG),
    config: ENGINE_CONFIG,
    configHashBefore: hashObject(ENGINE_CONFIG),
    configHashAfter: hashObject(recommended),
    method: "grid search over densityNorm x minCitationGap x minSimGrowth; objective = mean lift on scored@2020->2023 (threshold 0.5%,1.0%); held-out check scored@2017->2023 (threshold 1.0%); qualify 5..40 surfaced; ties break to current defaults",
    generatedAt: new Date().toISOString(),
  },
  grid,
  currentDefaults: {
    densityNorm: ENGINE_CONFIG.densityNorm,
    minCitationGap: ENGINE_CONFIG.minCitationGap,
    minSimGrowth: ENGINE_CONFIG.minSimGrowth,
  },
  best: best ?? null,
  recommended,
  results,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(output, null, 2));

console.log(`calibration written: ${outPath}`);
console.log("candidates evaluated:", results.length);
if (best) {
  console.log(
    `best: densityNorm=${best.densityNorm} minCitationGap=${best.minCitationGap} minSimGrowth=${best.minSimGrowth} ` +
      `calibLift=${best.calibLift} (surfaced ${best.calibSurfaced}) heldOutLift=${best.heldOutLift}`,
  );
  console.log(
    `current defaults: densityNorm=${ENGINE_CONFIG.densityNorm} minCitationGap=${ENGINE_CONFIG.minCitationGap} minSimGrowth=${ENGINE_CONFIG.minSimGrowth}`,
  );
  if (best.heldOutLift !== null && best.heldOutLift < 1) {
    console.log("HONEST WARNING: best config does NOT beat random on the held-out window — keep current defaults.");
  }
} else {
  console.log("no candidate qualifies (none surfaced 5..40 gaps) — keep current defaults.");
}

function coverageOf(st: ReturnType<typeof yearState>, f: string): number {
  const row = st.flows[f];
  if (!row || row._total_refs === 0) return 0;
  return row._total_refs_resolved / row._total_refs;
}

function distFromDefaults(c: CandidateResult): number {
  return (
    Math.abs(c.densityNorm - ENGINE_CONFIG.densityNorm) +
    Math.abs(c.minCitationGap - ENGINE_CONFIG.minCitationGap) +
    Math.abs(c.minSimGrowth - ENGINE_CONFIG.minSimGrowth)
  );
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}