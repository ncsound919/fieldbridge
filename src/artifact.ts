/**
 * FieldBridge Phase 1 — snapshot → dashboard artifact.
 *
 * Reads a Phase 1 snapshot (works[field][year]) and computes everything the
 * dashboard needs: per-year flow matrices, coverage/size normalization,
 * keyword overlap, the dual-signal gap leaderboard, and the run manifest.
 * Deterministic: pure functions of snapshot + ENGINE_CONFIG.
 *
 * Usage:
 *   npm run artifact -- --snapshot python/phase1/phase1_results.json --out public/fieldbridge-matrix.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  insertFieldPairs,
  insertGapSignals,
  insertRun,
  openStore,
} from "./lib/sqlite-store.js";
import {
  abstractText,
  allPairs,
  buildFlowMatrix,
  buildPairSeries,
  closingRank,
  cosine,
  emergingRank,
  ENGINE_CONFIG,
  hashObject,
  keywordCounts,
  normalizeFlow,
  rankGaps,
  scorePairs,
  validate,
  type Work,
} from "./lib/index.js";

interface SnapshotV2 {
  meta: { fields: string[]; years: number[]; sample_size: number; max_refs_per_field_year: number };
  works: Record<string, Record<string, Work[]>>;
  cited_fields: Record<string, string | null>;
}

const args = process.argv.slice(2);
const snapshotArg = args.find((a, i) => args[i - 1] === "--snapshot") ?? args[0];
const outPath = args.find((a, i) => args[i - 1] === "--out") ?? "public/fieldbridge-matrix.json";
const dbPath = args.find((a, i) => args[i - 1] === "--db");

if (!snapshotArg) {
  console.error("usage: npm run artifact -- --snapshot <snapshot.json> [--out <artifact.json>] [--db <history.db>]");
  process.exit(1);
}

const snap = JSON.parse(readFileSync(snapshotArg, "utf8")) as SnapshotV2;
const fields = snap.meta.fields;
const years = snap.meta.years;
const cache = new Map(Object.entries(snap.cited_fields)) as Map<string, string | null>;

// Per-year keyword profiles + flows.
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
  const flows = buildFlowMatrix(worksByField, cache, fields);
  return { flows, kws, sizes };
}

const states = new Map<number, ReturnType<typeof yearState>>();
for (const y of years) states.set(y, yearState(y));

const currentYear = years[years.length - 1]!;
const priorYear = years[years.length - 2] ?? years[0]!;
const cur = states.get(currentYear)!;
const prior = states.get(priorYear)!;
const norm = normalizeFlow(cur.flows, cur.sizes, fields);

// Keyword overlap matrix (current year). Sorted-pair keys, matching gaps/trends.
const pairKeyOf = (a: string, b: string) => [a, b].sort().join(" \u00d7 ");
const keywordOverlap: Record<string, number> = {};
for (const [a, b] of allPairs(fields)) {
  keywordOverlap[pairKeyOf(a, b)] = round4(cosine(cur.kws[a]!, cur.kws[b]!));
}

// Dual-signal gap scoring: current year, with the PREVIOUS year as the
// sim-growth baseline (not the window start).
const pairKeys = new Map<string, [string, string]>();
const crossFlowByYear: Record<number, Record<string, number>> = {};
const kwSimByYear: Record<number, Record<string, number>> = {};
for (const [a, b] of allPairs(fields)) {
  const key = [a, b].sort().join(" \u00d7 ");
  pairKeys.set(key, [a, b]);
  for (const y of years) {
    const st = states.get(y)!;
    crossFlowByYear[y] = crossFlowByYear[y] ?? {};
    kwSimByYear[y] = kwSimByYear[y] ?? {};
    crossFlowByYear[y]![key] = ((st.flows[a]?.[b] ?? 0) + (st.flows[b]?.[a] ?? 0)) / 2;
    kwSimByYear[y]![key] = cosine(st.kws[a]!, st.kws[b]!);
  }
}

const pairs = allPairs(fields).map(([a, b]) => {
  const key = [a, b].sort().join(" \u00d7 ");
  return {
    a,
    b,
    crossFlow: crossFlowByYear[currentYear]![key]!,
    kwSim: kwSimByYear[currentYear]![key]!,
    kwSimPrior: kwSimByYear[priorYear]![key] ?? 0,
    coverage: [norm.coverage[a] ?? 0, norm.coverage[b] ?? 0] as [number, number],
    sizes: [cur.sizes[a] ?? 0, cur.sizes[b] ?? 0] as [number, number],
  };
});
const scored = scorePairs(pairs, ENGINE_CONFIG);
const surfaced = rankGaps(scored, ENGINE_CONFIG.topK);
const suppressed = scored
  .filter((s) => !s.surfaced)
  .sort((x, y) => y.score - x.score)
  .slice(0, 50);
const surfacedKeys = new Set(surfaced.map((g) => g.pair));

// Trend series: which surfaced gaps are closing fastest, which are emerging.
const series = buildPairSeries(years, crossFlowByYear, kwSimByYear, surfacedKeys, [...pairKeys.values()]);
const closing = closingRank(series).slice(0, 20);
const emerging = emergingRank(series, ENGINE_CONFIG.densityNorm).slice(0, 20);

// Drilldown evidence for surfaced gaps: shared top keywords + bridge papers.
const drilldown: Record<string, { sharedKeywords: string[]; bridgePapers: number }> = {};
for (const g of surfaced) {
  const [a, b] = g.pair.split(" \u00d7 ") as [string, string];
  const sharedKeywords = sharedTokens(cur.kws[a] ?? {}, cur.kws[b] ?? {}, 10);
  const bridgePapers = countBridgePapers(a, b, currentYear, snap, cache, fields);
  drilldown[g.pair] = { sharedKeywords, bridgePapers };
}

const artifact = {
  manifest: {
    engine: `fieldbridge@${ENGINE_CONFIG.version}`,
    configHash: hashObject(ENGINE_CONFIG),
    snapshot: snapshotArg,
    works: fields.reduce((n, f) => n + Object.values(snap.works[f] ?? {}).reduce((m, w) => m + w.length, 0), 0),
    resolution: {
      refsCapPerFieldYear: snap.meta.max_refs_per_field_year ?? "unbounded",
      method: "stride-subset over sorted ref ids",
      note: "flow shares computed over the resolved subset of attempted refs",
    },
    generatedAt: new Date().toISOString(),
  },
  fields,
  years,
  flows: Object.fromEntries(years.map((y) => [String(y), states.get(y)!.flows])),
  per1k: norm.per1k,
  coverage: norm.coverage,
  sizes: norm.sizes,
  keywordOverlap,
  gaps: {
    surfaced: surfaced,
    suppressed: suppressed,
    signalCount: scored.length,
  },
  trends: {
    closing: closing,
    emerging: emerging,
    series: series.map((s) => ({
      pair: s.pair,
      crossFlow: s.crossFlow,
      kwSim: s.kwSim,
    })),
  },
  drilldown,
  checks: validate(cur.flows, cur.kws, fields),
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(artifact, null, 2));

// Optional durable store: append this run's aggregates to SQLite history.
if (dbPath) {
  const db = openStore(dbPath);
  const runId = insertRun(db, {
    engine: artifact.manifest.engine,
    configHash: artifact.manifest.configHash,
    snapshot: artifact.manifest.snapshot,
    works: artifact.manifest.works,
  });
  const pairRows = [];
  for (const y of years) {
    const st = states.get(y)!;
    for (const [a, b] of allPairs(fields)) {
      pairRows.push({
        fieldA: a,
        fieldB: b,
        year: y,
        flowAb: st.flows[a]?.[b] ?? 0,
        flowBa: st.flows[b]?.[a] ?? 0,
        per1kAb: 0, // per1k is computed only for the current year; see artifact.per1k
        per1kBa: 0,
        coverageA: coverageOf(st, a),
        coverageB: coverageOf(st, b),
        keywordOverlap: y === currentYear ? (keywordOverlap[pairKeyOf(a, b)] ?? null) : null,
      });
    }
  }
  // per1k for the current year (the artifact's normalized view).
  for (const [a, b] of allPairs(fields)) {
    const row = pairRows.find((r) => r.fieldA === a && r.fieldB === b && r.year === currentYear);
    if (row) {
      row.per1kAb = norm.per1k[a]?.[b] ?? 0;
      row.per1kBa = norm.per1k[b]?.[a] ?? 0;
    }
  }
  insertFieldPairs(db, runId, pairRows);
  insertGapSignals(
    db,
    runId,
    [...surfaced, ...suppressed].map((g) => ({
      fieldA: g.pair.split(" \u00d7 ")[0]!,
      fieldB: g.pair.split(" \u00d7 ")[1]!,
      year: currentYear,
      gapScore: g.score,
      citationGap: g.citationGap,
      simGrowth: g.simGrowth,
      status: g.surfaced ? "surfaced" : "suppressed",
      suppressedFor: g.suppressedFor,
    })),
  );
  db.close();
  console.log(`history appended: ${dbPath} (run ${runId})`);
}

console.log(`artifact written: ${outPath}`);
console.log(`fields: ${fields.length}, years: ${years.join(",")}`);
console.log(`gap pairs scored: ${scored.length}, surfaced: ${surfaced.length}`);
console.log(`closing gaps ranked: ${closing.length}, emerging: ${emerging.length}`);
if (surfaced.length > 0) {
  console.log("top gaps:");
  for (const g of surfaced.slice(0, 10)) {
    console.log(`  ${g.pair}: score ${g.score} (citeGap ${g.citationGap}, simGrowth ${g.simGrowth})`);
  }
} else {
  console.log("no gaps surfaced — all pairs suppressed (signals_disagree / coverage / size guards).");
}
if (closing.length > 0) {
  console.log("fastest-closing:");
  for (const c of closing.slice(0, 5)) {
    console.log(`  ${c.pair}: closingRate ${round4(c.closingRate)} (crossFlow ${round4(c.crossFlowCurrent)})`);
  }
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function coverageOf(st: { flows: Record<string, Record<string, number> & { _total_refs: number; _total_refs_resolved: number }> }, f: string): number {
  const row = st.flows[f];
  if (!row || row._total_refs === 0) return 0;
  return row._total_refs_resolved / row._total_refs;
}

/** Top tokens present in both keyword profiles, ranked by min frequency. */
function sharedTokens(
  a: Record<string, number>,
  b: Record<string, number>,
  topN: number,
): string[] {
  return Object.keys(a)
    .filter((k) => k in b)
    .sort((x, y) => Math.min(a[y]!, b[y]!) - Math.min(a[x]!, b[x]!))
    .slice(0, topN);
}

/**
 * Count distinct works in field `a`'s current-year sample that reference at
 * least one work resolved to field `b` (a -> b bridge papers), plus the
 * reverse direction. Uses only attempted refs (cache), consistent with the
 * flow matrix.
 */
function countBridgePapers(
  a: string,
  b: string,
  year: number,
  snap: SnapshotV2,
  cache: Map<string, string | null>,
  fields: string[],
): number {
  if (!fields.includes(a) || !fields.includes(b)) return 0;
  const bridge = new Set<string>();
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as Array<[string, string]>) {
    for (const w of snap.works[from]?.[String(year)] ?? []) {
      for (const rid of w.referenced_works ?? []) {
        if (cache.get(rid) === to) {
          bridge.add(w.id);
          break;
        }
      }
    }
  }
  return bridge.size;
}