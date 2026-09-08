import { describe, expect, it } from "vitest";
import {
  ENGINE_CONFIG,
  buildFlowMatrix,
  cosine,
  rankGaps,
  retrospectiveValidate,
  scorePairs,
} from "../src/lib/index.js";
import type { Work } from "../src/lib/types.js";

/**
 * Integration test for the retrospective-validation composition (the logic
 * src/validate-run.ts applies to the live snapshot):
 *
 *   score pairs at a historical period (current year, prior year as sim
 *   baseline) -> surface top-K -> check which of those bridged by the horizon.
 *
 * Synthetic dynamics: A×B is sparse at 2017 but its keywords converge and its
 * citation cross-flow rises by 2023 (it bridges). C is isolated throughout.
 */

const FIELDS = ["A", "B", "C"] as const;
const YEARS = [2014, 2017, 2023];

function worksFor(citations: { to: string; n: number }[]): Work[] {
  const refs: string[] = [];
  for (const c of citations) {
    for (let i = 0; i < c.n; i++) refs.push(`https://openalex.org/W-${c.to}-${i}`);
  }
  return [{ id: "w0", referenced_works: refs }];
}

function state(year: number, crossAB: number, kwAB: number) {
  const worksByField: Record<string, Work[]> = {
    // A cites B with share `crossAB` (of 100 refs), rest to A.
    A: worksFor([{ to: "B", n: Math.round(crossAB * 100) }, { to: "A", n: 100 - Math.round(crossAB * 100) }]),
    B: worksFor([{ to: "B", n: 100 }]),
    C: worksFor([{ to: "C", n: 100 }]),
  };
  const cache = new Map<string, string | null>();
  for (const f of FIELDS) for (let i = 0; i < 100; i++) cache.set(`https://openalex.org/W-${f}-${i}`, f);
  const flows = buildFlowMatrix(worksByField, cache, FIELDS);
  const kws: Record<string, Record<string, number>> = {
    A: { alpha: 100, shared: Math.round(kwAB * 100) },
    B: { beta: 100, shared: Math.round(kwAB * 100) },
    C: { gamma: 100 },
  };
  const sizes = { A: 1, B: 1, C: 1 } as Record<string, number>;
  return { year, flows, kws, sizes };
}

describe("retrospective validation integration", () => {
  it("hit-rate exceeds base rate when a surfaced gap actually bridges", () => {
    const s2014 = state(2014, 0.0, 0.1);
    const s2017 = state(2017, 0.01, 0.3); // sparse but keywords converging
    const s2023 = state(2023, 0.15, 0.3); // bridged by horizon

    // Score at 2017 (prior = 2014).
    const pairs = (
    [
      ["A", "B"],
      ["A", "C"],
      ["B", "C"],
    ] as Array<[string, string]>
  ).map(([a, b]) => ({
      a,
      b,
      crossFlow: ((s2017.flows[a]?.[b] ?? 0) + (s2017.flows[b]?.[a] ?? 0)) / 2,
      kwSim: cosine(s2017.kws[a]!, s2017.kws[b]!),
      kwSimPrior: cosine(s2014.kws[a]!, s2014.kws[b]!),
      coverage: [1, 1] as [number, number],
      sizes: [1000, 1000] as [number, number],
    }));
    const scored = scorePairs(pairs, ENGINE_CONFIG);
    const surfaced = rankGaps(scored, 2).map((g) => g.pair);

    // A×B must surface as a gap at 2017.
    expect(surfaced).toContain("A \u00d7 B");

    // Ground truth: bridged = cross-flow at 2023 >= 0.01.
    const cross2023 = new Map<string, number>([
      ["A \u00d7 B", ((s2023.flows.A?.B ?? 0) + (s2023.flows.B?.A ?? 0)) / 2],
      ["A \u00d7 C", 0],
      ["B \u00d7 C", 0],
    ]);
    const bridged = new Set([...cross2023.entries()].filter(([, v]) => v >= 0.01).map(([k]) => k));

    const res = retrospectiveValidate(
      [{ year: 2017, surfaced, scored: scored.map((g) => g.pair) }],
      bridged,
      2,
    );
    const baseRate = bridged.size / cross2023.size;

    expect(bridged.has("A \u00d7 B")).toBe(true);
    expect(res.hitRate).toBeGreaterThan(baseRate);
    expect(res.hitRate).toBeGreaterThan(0);
  });
});