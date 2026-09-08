/**
 * FieldBridge — rolling-origin prediction benchmark job.
 *
 * Evaluates the engine on untouched time windows against a set of explicit,
 * nontrivial baselines, with bootstrap confidence intervals and a
 * pre-registered success threshold. The output (`public/benchmark.json`) is
 * the artifact that decides whether the word "predictive" may be used.
 *
 * Design (see src/lib/benchmark.ts):
 *  - rolling-origin windows from the snapshot years:
 *      scored@2017 (prior 2014) -> horizon 2020   [held-out]
 *      scored@2020 (prior 2017) -> horizon 2023   [calibration window]
 *      scored@2023 (prior 2020) -> horizon 2023   [nowcast, no forward horizon]
 *  - thresholds frozen (ENGINE_CONFIG) before every window.
 *  - ground truth "bridged": cross-flow >= threshold at the horizon.
 *  - pre-registered bridge threshold = 1.0% (swept 0.5%/1%/2% for robustness).
 *
 * Usage:
 *   npm run benchmark -- --snapshot python/phase1/phase1_results.json --out public/benchmark.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  abstractText,
  allPairs,
  buildBenchmarkPairs,
  buildFlowMatrix,
  cosine,
  ENGINE_CONFIG,
  hashObject,
  keywordCounts,
  rollingOriginBenchmark,
  type BenchmarkWindow,
  type Work,
} from "./lib/index.js";

interface SnapshotV2 {
  meta: { fields: string[]; years: number[] };
  works: Record<string, Record<string, Work[]>>;
  cited_fields: Record<string, string | null>;
}

const args = process.argv.slice(2);
const snapshotArg = args.find((a, i) => args[i - 1] === "--snapshot") ?? args[0];
const outPath = args.find((a, i) => args[i - 1] === "--out") ?? "public/benchmark.json";

if (!snapshotArg) {
  console.error("usage: npm run benchmark -- --snapshot <snapshot.json> [--out <benchmark.json>]");
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

// Field-activity proxy for the field-size baseline: declared reference volume
// per field in the current scored year (varies 4.7x across fields; sampled
// work counts are equal by construction and are NOT a size signal).
function refVolumeOf(year: number): (f: string) => number {
  const st = states.get(year)!;
  return (f: string) => st.flows[f]?._total_refs ?? 0;
}

const TOP_K = ENGINE_CONFIG.topK;
const THRESHOLDS = [0.005, 0.01, 0.02];
const PRIMARY = 0.01;

function crossFlowAt(year: number): Map<string, number> {
  const st = states.get(year)!;
  const m = new Map<string, number>();
  for (const [a, b] of allPairs(fields)) {
    const key = [a, b].sort().join(" \u00d7 ");
    m.set(key, ((st.flows[a]?.[b] ?? 0) + (st.flows[b]?.[a] ?? 0)) / 2);
  }
  return m;
}

/** Rolling windows. A window is held-out iff it was never used to calibrate. */
const windows: BenchmarkWindow[] = [];
const defs: Array<{ current: number; prior: number; horizon: number; heldOut: boolean; calibrationWindow: boolean }> = [];
for (let i = 1; i < years.length; i++) {
  const current = years[i]!;
  const prior = years[i - 1]!;
  const horizon = years[i + 1];
  if (horizon === undefined) continue; // last year has no forward horizon
  defs.push({
    current,
    prior,
    horizon,
    heldOut: current <= 2017,
    calibrationWindow: current === 2020,
  });
}

if (defs.length === 0) {
  console.error("snapshot has no forward-looking rolling windows (need >= 3 years)");
  process.exit(1);
}

const bridgedByHorizon = new Map<number, Set<string>>();
for (const d of defs) {
  const horizonCross = crossFlowAt(d.horizon);
  for (const threshold of THRESHOLDS) {
    const set = new Set([...horizonCross.entries()].filter(([, v]) => v >= threshold).map(([k]) => k));
    bridgedByHorizon.set(d.horizon * 1000 + threshold, set);
  }
}

for (const d of defs) {
  const cur = states.get(d.current)!;
  const pr = states.get(d.prior)!;
  const pairs = allPairs(fields).map(([a, b]) => ({
    a,
    b,
    crossFlow: ((cur.flows[a]?.[b] ?? 0) + (cur.flows[b]?.[a] ?? 0)) / 2,
    crossFlowPrior: ((pr.flows[a]?.[b] ?? 0) + (pr.flows[b]?.[a] ?? 0)) / 2,
    kwSim: cosine(cur.kws[a]!, cur.kws[b]!),
    kwSimPrior: cosine(pr.kws[a]!, pr.kws[b]!),
    coverage: [coverageOf(cur, a), coverageOf(cur, b)] as [number, number],
    sizes: [cur.sizes[a] ?? 0, cur.sizes[b] ?? 0] as [number, number],
  }));
  windows.push({
    current: d.current,
    prior: d.prior,
    horizon: d.horizon,
    heldOut: d.heldOut,
    calibrationWindow: d.calibrationWindow,
    pairs: buildBenchmarkPairs(pairs, ENGINE_CONFIG, refVolumeOf(d.current)),
    bridged: new Set(),
  });
}

const thresholdsOut: Record<string, unknown> = {};
const primaryOut: Record<string, unknown> = {};
for (const threshold of THRESHOLDS) {
  for (const w of windows) {
    w.bridged = bridgedByHorizon.get(w.horizon * 1000 + threshold) ?? new Set();
  }
  const res = rollingOriginBenchmark(windows, ENGINE_CONFIG, TOP_K);
  const obj = JSON.parse(JSON.stringify(res));
  thresholdsOut[String(threshold)] = obj;
  if (threshold === PRIMARY) Object.assign(primaryOut, obj);
}

const output = {
  manifest: {
    engine: `fieldbridge@${ENGINE_CONFIG.version}`,
    configHash: hashObject(ENGINE_CONFIG),
    config: ENGINE_CONFIG,
    snapshot: snapshotArg,
    method: "rolling-origin; frozen ENGINE_CONFIG; held-out windows excluded from calibration; ground truth = cross-flow >= threshold at horizon",
    primaryThreshold: PRIMARY,
    thresholdsSwept: THRESHOLDS,
    bootstrap: { draws: 2000, type: "pair-resampling over eligible population", seed: "deterministic per threshold" },
    generatedAt: new Date().toISOString(),
  },
  windows: windows.map((w) => ({ current: w.current, prior: w.prior, horizon: w.horizon, heldOut: w.heldOut, calibrationWindow: w.calibrationWindow })),
  thresholds: thresholdsOut,
  primary: primaryOut,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(output, null, 2));

console.log(`benchmark written: ${outPath}`);
const primary = primaryOut as { verdict: { state: string; reason: string }; pooled: { lift: number | null } | null };
console.log(`verdict: ${primary.verdict.state} — ${primary.verdict.reason}`);
console.log(`pooled held-out lift (1.0%): ${primary.pooled?.lift ?? "n/a"}`);
for (const w of (primaryOut as { windows: Array<{ current: number; horizon: number; heldOut: boolean; hitRate: number; baseRate: number; lift: number | null; liftCI: { lower: number; upper: number } | null }> }).windows) {
  const tag = w.heldOut ? "HELD-OUT" : w.current === 2020 ? "calibration-window" : "nowcast";
  console.log(
    `  scored@${w.current} -> ${w.horizon} [${tag}]: hitRate ${w.hitRate} baseRate ${w.baseRate} ` +
      `lift ${w.lift ?? "n/a"} (95% CI ${w.liftCI ? `${w.liftCI.lower}..${w.liftCI.upper}` : "n/a"})`,
  );
}

function coverageOf(st: ReturnType<typeof yearState>, f: string): number {
  const row = st.flows[f];
  if (!row || row._total_refs === 0) return 0;
  return row._total_refs_resolved / row._total_refs;
}