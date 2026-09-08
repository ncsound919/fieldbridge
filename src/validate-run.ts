/**
 * FieldBridge Phase 3 — retrospective validation job.
 *
 * The institutional credibility artifact: of the gaps this engine surfaced at
 * a historical period, how many actually bridged by the horizon? Pure
 * functions of the stored multi-year snapshot + ENGINE_CONFIG; no fabrication.
 *
 * Procedure, per window (currentYear scored with priorYear as sim baseline):
 *   1. score all pairs and surface the top-K gaps,
 *   2. ground truth "bridged": the pair's cross-flow at the horizon year
 *      exceeded a threshold,
 *   3. hit-rate = |surfaced ∩ bridged| / |surfaced|, reported alongside the
 *      base rate (fraction of ALL pairs bridged) so the number is read
 *      honestly — a hit-rate that does not beat random selection is a
 *      finding, not a credential.
 *
 * Thresholds are swept (0.5%, 1%, 2% cross-flow share) rather than fixed, so
 * no single threshold is cherry-picked.
 *
 * Usage:
 *   npm run validate -- --snapshot python/phase1/phase1_results.json --out public/validation.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { insertValidationRuns, openStore } from "./lib/sqlite-store.js";
import {
  abstractText,
  allPairs,
  buildFlowMatrix,
  cosine,
  ENGINE_CONFIG,
  hashObject,
  keywordCounts,
  rankGaps,
  retrospectiveValidate,
  scorePairs,
  type Work,
} from "./lib/index.js";

interface SnapshotV2 {
  meta: { fields: string[]; years: number[] };
  works: Record<string, Record<string, Work[]>>;
  cited_fields: Record<string, string | null>;
}

const args = process.argv.slice(2);
const snapshotArg = args.find((a, i) => args[i - 1] === "--snapshot") ?? args[0];
const outPath = args.find((a, i) => args[i - 1] === "--out") ?? "public/validation.json";
const dbPath = args.find((a, i) => args[i - 1] === "--db");

if (!snapshotArg) {
  console.error("usage: npm run validate -- --snapshot <snapshot.json> [--out <validation.json>] [--db <history.db>]");
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
  return {
    flows: buildFlowMatrix(worksByField, cache, fields),
    kws,
    sizes,
  };
}

const states = new Map<number, ReturnType<typeof yearState>>();
for (const y of years) states.set(y, yearState(y));

const crossFlowAt = (year: number): Map<string, number> => {
  const st = states.get(year)!;
  const m = new Map<string, number>();
  for (const [a, b] of allPairs(fields)) {
    const key = [a, b].sort().join(" \u00d7 ");
    m.set(key, ((st.flows[a]?.[b] ?? 0) + (st.flows[b]?.[a] ?? 0)) / 2);
  }
  return m;
};

const THRESHOLDS = [0.005, 0.01, 0.02];
const TOP_K = ENGINE_CONFIG.topK;

// Every contiguous (current, prior) pair we can score, checked against the
// last available year as horizon.
const last = years[years.length - 1]!;
const windows: Array<{ current: number; prior: number }> = [];
for (let i = 1; i < years.length; i++) {
  windows.push({ current: years[i]!, prior: years[i - 1]! });
}

const results = [];
for (const { current, prior } of windows) {
  const cur = states.get(current)!;
  const pr = states.get(prior)!;
  const norm = cur; // sizes used for guards
  const pairs = allPairs(fields).map(([a, b]) => {
    const key = [a, b].sort().join(" \u00d7 ");
    return {
      a,
      b,
      crossFlow: ((cur.flows[a]?.[b] ?? 0) + (cur.flows[b]?.[a] ?? 0)) / 2,
      kwSim: cosine(cur.kws[a]!, cur.kws[b]!),
      kwSimPrior: cosine(pr.kws[a]!, pr.kws[b]!),
      coverage: [coverageOf(norm, a), coverageOf(norm, b)] as [number, number],
      sizes: [norm.sizes[a] ?? 0, norm.sizes[b] ?? 0] as [number, number],
    };
  });
  const scored = scorePairs(pairs, ENGINE_CONFIG);
  const surfacedKeys = rankGaps(scored, TOP_K).map((g) => g.pair);
  const scoredKeys = scored.map((g) => g.pair);

  const horizonCross = crossFlowAt(last);
  const allKeys = [...horizonCross.keys()];

  for (const threshold of THRESHOLDS) {
    const bridged = new Set([...horizonCross.entries()].filter(([, v]) => v >= threshold).map(([k]) => k));
    const res = retrospectiveValidate(
      [{ year: current, surfaced: surfacedKeys, scored: scoredKeys }],
      bridged,
      TOP_K,
    );
    const baseRate = allKeys.length > 0 ? bridged.size / allKeys.length : 0;
    results.push({
      current,
      prior,
      horizon: last,
      threshold,
      surfaced: res.totalSurfaced,
      bridged: res.bridgedCount,
      hitRate: round4(res.hitRate),
      baseRate: round4(baseRate),
      lift: baseRate > 0 ? round4(res.hitRate / baseRate) : null, // hit-rate vs random
      precisionAtK: res.precisionAtK.map(round4),
      bridgedPairs: [...bridged],
    });
  }
}

const output = {
  manifest: {
    engine: `fieldbridge@${ENGINE_CONFIG.version}`,
    configHash: hashObject(ENGINE_CONFIG),
    config: ENGINE_CONFIG,
    snapshot: snapshotArg,
    method: "score at (current, prior), check cross-flow at horizon; threshold sweep, base-rate reported",
    generatedAt: new Date().toISOString(),
  },
  fields: fields.length,
  years,
  windows: results,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(output, null, 2));

if (dbPath) {
  const db = openStore(dbPath);
  insertValidationRuns(
    db,
    results.map((w) => ({
      scoredYear: w.current,
      priorYear: w.prior,
      horizonYear: w.horizon,
      threshold: w.threshold,
      topK: TOP_K,
      hitRate: w.hitRate,
      baseRate: w.baseRate,
      lift: w.lift,
      totalSurfaced: w.surfaced,
      bridgedCount: w.bridged,
    })),
  );
  db.close();
  console.log(`validation history appended: ${dbPath}`);
}

console.log(`validation written: ${outPath}`);
for (const w of results) {
  const flag = w.lift !== null && w.lift >= 1 ? " (beats random)" : w.lift !== null ? " (no lift)" : "";
  console.log(
    `  scored@${w.current} (prior ${w.prior}) -> horizon ${w.horizon}, ` +
      `threshold ${(w.threshold * 100).toFixed(1)}%: hitRate ${w.hitRate} ` +
      `baseRate ${w.baseRate} lift ${w.lift ?? "n/a"}${flag} [${w.bridged}/${w.surfaced} bridged]`,
  );
}

function coverageOf(st: ReturnType<typeof yearState>, f: string): number {
  const row = st.flows[f];
  if (!row || row._total_refs === 0) return 0;
  return row._total_refs_resolved / row._total_refs;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}