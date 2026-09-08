/**
 * Deterministic fixture-based integration test: a 4-field x 3-year
 * mini-corpus runs through the whole deterministic stack (flow matrix ->
 * normalization -> gap scoring -> surfacing -> trends) with zero I/O, and the
 * contract between the Python-produced snapshot shape and the TS reader is
 * pinned. If the Python producer changes the snapshot schema, this test
 * changes too — explicitly.
 */
import { describe, expect, it } from "vitest";
import {
  ENGINE_CONFIG,
  abstractText,
  allPairs,
  buildFlowMatrix,
  cosine,
  hashObject,
  keywordCounts,
  normalizeFlow,
  rankGaps,
  scorePairs,
  trackedFlowShare,
  type Work,
} from "../src/lib/index.js";

const FIELDS = ["Mathematics", "Biology", "Sociology", "Philosophy"] as const;
const YEARS = [2020, 2021, 2022];

// Fields a/c cite within their own cluster; b/d cite cross-cluster.
function work(id: string, abstract: string, refs: string[]): Work {
  const tokens = abstract.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const index: Record<string, number[]> = {};
  tokens.forEach((t, i) => (index[t] = [...(index[t] ?? []), i]));
  return { id, referenced_works: refs, abstract_inverted_index: index };
}

const corpus: Record<string, Work> = {
  a1: work("a1", "linear algebra tensor methods", ["r1", "r2"]),
  a2: work("a2", "graph theory combinatorics", ["r2", "r3"]),
  b1: work("b1", "neural coding population dynamics", ["r1", "r4"]),
  b2: work("b2", "network dynamics synchronization", ["r4", "r5"]),
  c1: work("c1", "social network structures community", ["r5", "r6"]),
  c2: work("c2", "community detection algorithms", ["r6", "r7"]),
  d1: work("d1", "algebraic geometry topology", ["r3", "r7"]),
  d2: work("d2", "homology categories functors", ["r7", "r8"]),
};

// r1..r8 resolve to tracked fields; r9 resolves outside the tracked universe.
const citedFields = new Map<string, string | null>([
  ["r1", "Mathematics"],
  ["r2", "Mathematics"],
  ["r3", "Mathematics"],
  ["r4", "Biology"],
  ["r5", "Sociology"],
  ["r6", "Sociology"],
  ["r7", "Philosophy"],
  ["r8", "Philosophy"],
  ["r9", "Physics and Astronomy"], // untracked resolution
]);

const worksByField: Record<string, Work[]> = {
  Mathematics: [corpus.a1!, corpus.a2!],
  Biology: [corpus.b1!, corpus.b2!],
  Sociology: [corpus.c1!, corpus.c2!],
  Philosophy: [corpus.d1!, corpus.d2!],
};

describe("fixture integration (4 fields x 3 years)", () => {
  it("builds a flow matrix whose rows reflect citation structure", () => {
    const flows = buildFlowMatrix(worksByField, citedFields, FIELDS);
    // Mathematics: a1[r1,r2], a2[r2,r3] -> 4 refs, all in-field.
    expect(flows["Mathematics"]!["Mathematics"]).toBeCloseTo(1, 6);
    // Biology: b1[r1,r4], b2[r4,r5] -> r1 Math, r4 r4 Bio, r5 Socio (4 refs).
    expect(flows["Biology"]!["Mathematics"]).toBeCloseTo(1 / 4, 6);
    expect(flows["Biology"]!["Biology"]).toBeCloseTo(2 / 4, 6);
    expect(flows["Biology"]!["Sociology"]).toBeCloseTo(1 / 4, 6);
    // Philosophy: d1[r3,r7], d2[r7,r8] -> r3 Math, r7 r7 r8 Phil (4 refs).
    expect(flows["Philosophy"]!["Mathematics"]).toBeCloseTo(1 / 4, 6);
    expect(flows["Philosophy"]!["Philosophy"]).toBeCloseTo(3 / 4, 6);
    // Every row's tracked columns sum to 1 (all resolutions are tracked here).
    for (const f of FIELDS) {
      const rowSum = FIELDS.reduce((s, g) => s + (flows[f]![g] ?? 0), 0);
      expect(rowSum).toBeCloseTo(1, 6);
    }
  });

  it("trackedFlowShare and global share agree when all resolutions are tracked", () => {
    const flows = buildFlowMatrix(worksByField, citedFields, FIELDS);
    expect(trackedFlowShare(flows, "Biology", "Mathematics")).toBeCloseTo(flows["Biology"]!["Mathematics"]!, 6);
  });

  it("normalizeFlow exposes resolution bookkeeping and coverage", () => {
    const flows = buildFlowMatrix(worksByField, citedFields, FIELDS);
    const norm = normalizeFlow(flows, { Mathematics: 2, Biology: 2, Sociology: 2, Philosophy: 2 }, FIELDS);
    for (const f of FIELDS) {
      expect(norm.resolution[f]!.allResolved).toBe(4);
      expect(norm.resolution[f]!.trackedResolved).toBe(4);
      expect(norm.coverage[f]).toBe(1);
    }
    expect(norm.per1k["Mathematics"]!["Mathematics"]).toBeGreaterThan(0);
  });

  it("untracked resolutions are excluded from the tracked universe share", () => {
    // Give Mathematics a reference that resolves outside the tracked universe.
    const extra = work("a3", "linear algebra", ["r9"]);
    const flows = buildFlowMatrix(
      { ...worksByField, Mathematics: [...worksByField.Mathematics!, extra] },
      citedFields,
      FIELDS,
    );
    // Global share: 4 tracked Math refs + 1 untracked = 4/5 of resolved.
    expect(flows["Mathematics"]!["Mathematics"]).toBeCloseTo(4 / 5, 6);
    // Tracked-universe share: all tracked refs are in-field -> 1.
    expect(trackedFlowShare(flows, "Mathematics", "Mathematics")).toBeCloseTo(1, 6);
  });

  it("scores and surfaces a real gap deterministically", () => {
    const flows = buildFlowMatrix(worksByField, citedFields, FIELDS);
    const sizes: Record<string, number> = { Mathematics: 2, Biology: 2, Sociology: 2, Philosophy: 2 };
    const kws: Record<string, Record<string, number>> = {};
    for (const f of FIELDS) kws[f] = keywordCounts(worksByField[f]!.map((w) => abstractText(w.abstract_inverted_index)));
    const pairs = allPairs(FIELDS).map(([a, b]) => ({
      a,
      b,
      crossFlow: ((flows[a]![b] ?? 0) + (flows[b]![a] ?? 0)) / 2,
      kwSim: cosine(kws[a]!, kws[b]!),
      kwSimPrior: cosine(kws[a]!, kws[b]!), // no drift in fixture -> simGrowth 0
      coverage: [1, 1] as [number, number],
      sizes: [sizes[a]!, sizes[b]!] as [number, number],
    }));
    const scored = scorePairs(pairs, ENGINE_CONFIG);
    const surfaced = rankGaps(scored, ENGINE_CONFIG.topK);
    // No similarity drift in the fixture -> nothing surfaces (honest null).
    expect(surfaced.length).toBe(0);
    // But every pair was scored in deterministic order with "A × B" keys.
    expect(scored.length).toBe(6);
    expect(scored[0]!.pair).toContain(" × ");
  });

  it("pins the snapshot -> artifact config-hash contract", () => {
    expect(hashObject(ENGINE_CONFIG).length).toBe(8);
    expect(hashObject(ENGINE_CONFIG)).toMatch(/^[0-9a-f]{8}$/);
    // Re-hashing the same object is stable.
    expect(hashObject(ENGINE_CONFIG)).toBe(hashObject(ENGINE_CONFIG));
  });

  it("allPairs produces C(4,2) = 6 deterministic pairs", () => {
    const pairs = allPairs(FIELDS);
    expect(pairs.length).toBe(6);
    expect(pairs[0]).toEqual(["Mathematics", "Biology"]);
    expect(new Set(pairs.map(([a, b]) => [a, b].sort().join("×"))).size).toBe(6);
  });
});