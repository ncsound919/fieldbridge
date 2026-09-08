/**
 * FieldBridge Phase 2 — subfield-level rolling-origin benchmark.
 *
 * The research hypothesis (FOS benchmark, granularity literature): prediction
 * is statistically viable at subfield/topic granularity (~31k pairs) and dead
 * at field granularity (325 pairs). This job tests that hypothesis on our own
 * data by running the identical rolling-origin benchmark at the subfield
 * level and reporting whether the verdict moves off PENDING.
 *
 * Data: a phase1 snapshot WITH work_subfields + cited_subfields (the Phase 2
 * pipeline captures both). Works are grouped by their OWN primary subfield
 * (not the sampling field); refs resolve to cited subfields.
 *
 * Config: field-level guards (minPubs=100, topK=20) were tuned for 26 units
 * and would suppress nearly every subfield. SUBFIELD_CONFIG adjusts scale
 * guards (minPubs, topK) while keeping the signal thresholds identical; it is
 * a separate experiment with its own hash, disclosed in the manifest — NOT a
 * silent re-tune of the field experiment.
 *
 * Usage:
 *   npm run benchmark:subfield -- --snapshot python/phase1/phase1_subfield_results.json --out public/subfield-benchmark.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  abstractText,
  allPairs,
  buildBenchmarkPairs,
  buildFlowMatrix,
  cosine,
  diversityOf,
  ENGINE_CONFIG,
  hashObject,
  keywordCounts,
  rollingOriginBenchmark,
  SUBFIELD_CONFIG,
  type BenchmarkWindow,
  type Work,
} from "./lib/index.js";

interface SnapshotV2 {
  meta: { fields: string[]; years: number[] };
  works: Record<string, Record<string, Work[]>>;
  cited_fields: Record<string, string | null>;
  cited_subfields?: Record<string, string | null>;
  work_subfields?: Record<string, string | null>;
}

const args = process.argv.slice(2);
const snapshotArg = args.find((a, i) => args[i - 1] === "--snapshot") ?? args[0];
const outPath = args.find((a, i) => args[i - 1] === "--out") ?? "public/subfield-benchmark.json";

if (!snapshotArg) {
  console.error("usage: npm run benchmark:subfield -- --snapshot <snapshot.json> [--out <subfield-benchmark.json>]");
  process.exit(1);
}

const snap = JSON.parse(readFileSync(snapshotArg, "utf8")) as SnapshotV2;
const years = snap.meta.years;
if (!snap.cited_subfields || !snap.work_subfields) {
  console.error("snapshot lacks cited_subfields/work_subfields — run the Phase 2 pipeline first");
  process.exit(1);
}
const subCache = new Map(Object.entries(snap.cited_subfields)) as Map<string, string | null>;
const workSubs = new Map(Object.entries(snap.work_subfields)) as Map<string, string | null>;

// Unit universe: subfields that own at least one sampled work (excludes
// null/Unknown; those count as untracked resolutions, not units).
const units = [...new Set(
  [...workSubs.values()].filter((s): s is string => !!s && s !== "Unknown"),
)].sort();

function yearState(year: number) {
  const worksByUnit: Record<string, Work[]> = {};
  const sizes: Record<string, number> = {};
  const kws: Record<string, Record<string, number>> = {};
  for (const u of units) {
    worksByUnit[u] = [];
    sizes[u] = 0;
  }
  for (const f of snap.meta.fields) {
    for (const w of snap.works[f]?.[String(year)] ?? []) {
      const u = workSubs.get(w.id);
      if (!u || u === "Unknown" || !worksByUnit[u]) continue;
      worksByUnit[u]!.push(w);
    }
  }
  for (const u of units) {
    sizes[u] = worksByUnit[u]!.length;
    kws[u] = keywordCounts(worksByUnit[u]!.map((w) => abstractText(w.abstract_inverted_index)));
  }
  return { flows: buildFlowMatrix(worksByUnit, subCache, units), kws, sizes };
}

const states = new Map<number, ReturnType<typeof yearState>>();
for (const y of years) states.set(y, yearState(y));

const TOP_K = SUBFIELD_CONFIG.topK;
const THRESHOLDS = [0.005, 0.01, 0.02];
const PRIMARY = 0.01;

function crossFlowAt(year: number): Map<string, number> {
  const st = states.get(year)!;
  const m = new Map<string, number>();
  for (const [a, b] of allPairs(units)) {
    const key = [a, b].sort().join(" \u00d7 ");
    m.set(key, ((st.flows[a]?.[b] ?? 0) + (st.flows[b]?.[a] ?? 0)) / 2);
  }
  return m;
}

function refVolumeOf(year: number): (u: string) => number {
  const st = states.get(year)!;
  return (u: string) => st.flows[u]?._total_refs ?? 0;
}

const windows: BenchmarkWindow[] = [];
const defs: Array<{ current: number; prior: number; horizon: number; heldOut: boolean; calibrationWindow: boolean }> = [];
for (let i = 1; i < years.length; i++) {
  const current = years[i]!;
  const prior = years[i - 1]!;
  const horizon = years[i + 1];
  if (horizon === undefined) continue;
  defs.push({ current, prior, horizon, heldOut: true, calibrationWindow: false });
}

if (defs.length === 0) {
  console.error("snapshot has no forward-looking rolling windows (need >= 3 years)");
  process.exit(1);
}

for (const d of defs) {
  const cur = states.get(d.current)!;
  const pr = states.get(d.prior)!;
  const pairs = allPairs(units).map(([a, b]) => ({
    a,
    b,
    crossFlow: ((cur.flows[a]?.[b] ?? 0) + (cur.flows[b]?.[a] ?? 0)) / 2,
    crossFlowPrior: ((pr.flows[a]?.[b] ?? 0) + (pr.flows[b]?.[a] ?? 0)) / 2,
    kwSim: cosine(cur.kws[a]!, cur.kws[b]!),
    kwSimPrior: cosine(pr.kws[a]!, pr.kws[b]!),
    coverage: [coverageOf(cur, a), coverageOf(cur, b)] as [number, number],
    sizes: [cur.sizes[a] ?? 0, cur.sizes[b] ?? 0] as [number, number],
  }));
  const built = buildBenchmarkPairs(pairs, SUBFIELD_CONFIG, refVolumeOf(d.current));
  const rsCur = new Map(units.map((u) => [u, diversityOf(cur.flows, u, units).raoStirling]));
  const rsPrior = new Map(units.map((u) => [u, diversityOf(pr.flows, u, units).raoStirling]));
  for (const p of built) {
    p.divGrowthAB = round4((rsCur.get(p.a) ?? 0) - (rsPrior.get(p.a) ?? 0) + (rsCur.get(p.b) ?? 0) - (rsPrior.get(p.b) ?? 0));
  }
  windows.push({
    current: d.current,
    prior: d.prior,
    horizon: d.horizon,
    heldOut: d.heldOut,
    calibrationWindow: d.calibrationWindow,
    pairs: built,
    bridged: new Set(),
  });
}

const thresholdsOut: Record<string, unknown> = {};
const primaryOut: Record<string, unknown> = {};
for (const threshold of THRESHOLDS) {
  for (const w of windows) {
    const horizonCross = crossFlowAt(w.horizon);
    w.bridged = new Set([...horizonCross.entries()].filter(([, v]) => v >= threshold).map(([k]) => k));
  }
  const res = rollingOriginBenchmark(windows, SUBFIELD_CONFIG, TOP_K);
  const obj = JSON.parse(JSON.stringify(res));
  thresholdsOut[String(threshold)] = obj;
  if (threshold === PRIMARY) Object.assign(primaryOut, obj);
}

const output = {
  manifest: {
    engine: `fieldbridge@${SUBFIELD_CONFIG.version}`,
    configHash: hashObject(SUBFIELD_CONFIG),
    config: SUBFIELD_CONFIG,
    units: units.length,
    unitLevel: "subfield",
    snapshot: snapshotArg,
    method: "rolling-origin at subfield granularity; all windows held-out (subfield config never calibrated); ground truth = cross-flow >= threshold at horizon",
    primaryThreshold: PRIMARY,
    thresholdsSwept: THRESHOLDS,
    bootstrap: { draws: 2000, type: "pair-resampling over eligible population", seed: "deterministic per threshold" },
    generatedAt: new Date().toISOString(),
  },
  units: units.length,
  windows: windows.map((w) => ({ current: w.current, prior: w.prior, horizon: w.horizon, heldOut: w.heldOut })),
  thresholds: thresholdsOut,
  primary: primaryOut,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(output, null, 2));

console.log(`subfield benchmark written: ${outPath}`);
console.log(`units: ${units.length}, pairs: ${allPairs(units).length}`);
const primary = primaryOut as { verdict: { state: string; reason: string } };
console.log(`verdict: ${primary.verdict.state} — ${primary.verdict.reason}`);

function coverageOf(st: ReturnType<typeof yearState>, f: string): number {
  const row = st.flows[f];
  if (!row || row._total_refs === 0) return 0;
  return row._total_refs_resolved / row._total_refs;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}