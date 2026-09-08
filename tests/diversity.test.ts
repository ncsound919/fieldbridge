import { describe, expect, it } from "vitest";
import {
  bootstrapRaoStirling,
  convergenceTest,
  convergingRank,
  disparityMatrix,
  diversityOf,
  gini,
  raoStirling,
  referenceShares,
  simpson as simpsonFn,
  shannon as shannonFn,
  type FlowMatrix,
} from "../src/lib/index.js";

// Minimal flow matrix: three categories A, B, C. A references B and C equally;
// B cites only itself; C cites only itself. Resolved totals are known.
function fixture(): FlowMatrix {
  return {
    A: { B: 0.5, C: 0.5, A: 0, _total_refs: 100, _total_refs_resolved: 100 },
    B: { B: 1, A: 0, C: 0, _total_refs: 100, _total_refs_resolved: 100 },
    C: { C: 1, A: 0, B: 0, _total_refs: 100, _total_refs_resolved: 100 },
  };
}
const CATS = ["A", "B", "C"] as const;

describe("referenceShares", () => {
  it("renormalizes over the tracked universe", () => {
    const p = referenceShares(fixture(), "A", CATS);
    expect(p["B"]).toBeCloseTo(0.5, 6);
    expect(p["C"]).toBeCloseTo(0.5, 6);
    expect(Object.values(p).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
  });

  it("returns zeros for an empty row", () => {
    const f = fixture();
    const p = referenceShares({ ...f, X: { A: 0, _total_refs: 0, _total_refs_resolved: 0 } }, "X", CATS);
    expect(Object.values(p).every((v) => v === 0)).toBe(true);
  });
});

describe("raoStirling", () => {
  it("is zero when all references are maximally distant-but-identical profiles", () => {
    const d = { X: { X: 0 }, Y: { X: 0 } };
    expect(raoStirling({ X: 1, Y: 0 }, ["X", "Y"], d)).toBe(0); // single category
  });

  it("equals 2*p1*p2 for two maximally distant categories", () => {
    const d = { X: { X: 0, Y: 1 }, Y: { X: 1, Y: 0 } };
    expect(raoStirling({ X: 0.5, Y: 0.5 }, ["X", "Y"], d)).toBeCloseTo(0.5, 6);
  });

  it("grows when a field draws on distant categories", () => {
    const f = fixture();
    const d = disparityMatrix(f, CATS);
    const focused = raoStirling({ A: 1, B: 0, C: 0 }, CATS, d);
    const diverse = raoStirling({ A: 0, B: 0.5, C: 0.5 }, CATS, d);
    expect(diverse).toBeGreaterThan(focused);
  });
});

describe("gini / shannon / simpson", () => {
  it("gini is 0 for equal shares", () => {
    expect(gini([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(0, 6);
  });
  it("gini is 0 for a single-category distribution", () => {
    expect(gini([1])).toBe(0);
  });
  it("gini rises with inequality", () => {
    expect(gini([0.9, 0.1])).toBeGreaterThan(gini([0.5, 0.5]));
  });
  it("shannon([0.5,0.5]) = ln 2", () => {
    expect(shannonFn({ X: 0.5, Y: 0.5 }, ["X", "Y"] as const)).toBeCloseTo(Math.LN2, 6);
  });
  it("simpson([0.5,0.5]) = 0.5", () => {
    expect(simpsonFn({ X: 0.5, Y: 0.5 }, ["X", "Y"] as const)).toBeCloseTo(0.5, 6);
  });
});

describe("diversityOf", () => {
  it("decomposes RS into variety x balance x disparity exactly", () => {
    const prof = diversityOf(fixture(), "A", CATS);
    expect(prof.n).toBe(2);
    expect(prof.N).toBe(3);
    expect(prof.variety).toBeCloseTo(2 / 3, 6);
    expect(prof.div).toBeCloseTo(prof.variety * prof.balance * prof.disparity, 6);
    expect(prof.refs).toBe(100);
  });

  it("a mono-category field has RS 0", () => {
    const prof = diversityOf(fixture(), "B", CATS);
    expect(prof.raoStirling).toBe(0);
    expect(prof.n).toBe(1);
  });
});

describe("bootstrapRaoStirling", () => {
  it("is deterministic and the CI contains the point estimate", () => {
    const f = fixture();
    const a = bootstrapRaoStirling(f, "A", CATS, { draws: 200, seed: 7 });
    const b = bootstrapRaoStirling(f, "A", CATS, { draws: 200, seed: 7 });
    expect(a).toEqual(b);
    const point = diversityOf(f, "A", CATS).raoStirling;
    expect(a.lower).toBeLessThanOrEqual(point);
    expect(point).toBeLessThanOrEqual(a.upper);
    expect(a.upper).toBeGreaterThanOrEqual(a.lower);
  });
});

describe("convergenceTest", () => {
  it("flags a large reciprocal spike as significant", () => {
    const t = convergenceTest({
      countAB: 40, totalA: 1000, countBA: 30, totalB: 1000,
      priorCountAB: 5, priorTotalA: 1000, priorCountBA: 4, priorTotalB: 1000,
    });
    expect(t.reciprocal).toBe(true);
    expect(t.significantAB).toBe(true);
    expect(t.significantBA).toBe(true);
  });

  it("is not reciprocal when only one direction grows", () => {
    const t = convergenceTest({
      countAB: 40, totalA: 1000, countBA: 4, totalB: 1000,
      priorCountAB: 5, priorTotalA: 1000, priorCountBA: 4, priorTotalB: 1000,
    });
    expect(t.significantAB).toBe(true);
    expect(t.reciprocal).toBe(false);
  });

  it("zero growth is never significant", () => {
    const t = convergenceTest({
      countAB: 10, totalA: 1000, countBA: 10, totalB: 1000,
      priorCountAB: 10, priorTotalA: 1000, priorCountBA: 10, priorTotalB: 1000,
    });
    expect(t.reciprocal).toBe(false);
  });
});

describe("convergingRank", () => {
  it("only admits reciprocal-significant baseline-surfaced pairs", () => {
    const series = [
      { a: "A", b: "B", pair: "A × B", years: [2020, 2023], crossFlow: [0.01, 0.05], kwSim: [0.1, 0.2], surfacedAtBaseline: true },
      { a: "C", b: "D", pair: "C × D", years: [2020, 2023], crossFlow: [0.01, 0.05], kwSim: [0.1, 0.2], surfacedAtBaseline: false },
    ];
    const strong = convergenceTest({
      countAB: 40, totalA: 1000, countBA: 30, totalB: 1000,
      priorCountAB: 5, priorTotalA: 1000, priorCountBA: 4, priorTotalB: 1000,
    });
    const ranked = convergingRank(series as never, { "A × B": strong, "C × D": strong });
    expect(ranked.map((r) => r.pair)).toEqual(["A × B"]);
  });
});