import { describe, expect, it } from "vitest";
import { retrospectiveValidate, type HistoricalRun } from "../src/lib/validation";

describe("retrospectiveValidate", () => {
  const bridged = new Set(["math \u00d7 philosophy", "bio \u00d7 socio"]);

  it("computes hit-rate over surfaced gaps", () => {
    const runs: HistoricalRun[] = [
      {
        year: 2021,
        surfaced: ["math \u00d7 philosophy", "bio \u00d7 chemistry", "socio \u00d7 law"],
        scored: ["math \u00d7 philosophy", "bio \u00d7 chemistry", "socio \u00d7 law"],
      },
      {
        year: 2022,
        surfaced: ["bio \u00d7 socio", "math \u00d7 chemistry"],
        scored: ["bio \u00d7 socio", "math \u00d7 chemistry"],
      },
    ];
    const res = retrospectiveValidate(runs, bridged, 10);
    // surfaced union = {math×phil, bio×chem, socio×law, bio×socio, math×chem} = 5; bridged = 2.
    expect(res.totalSurfaced).toBe(5);
    expect(res.bridgedCount).toBe(2);
    expect(res.hitRate).toBeCloseTo(0.4, 6);
  });

  it("respects topK when clipping surfaced pairs", () => {
    const runs: HistoricalRun[] = [
      { year: 2021, surfaced: ["math \u00d7 philosophy", "bio \u00d7 socio", "socio \u00d7 law"], scored: [] },
    ];
    const res = retrospectiveValidate(runs, bridged, 2);
    expect(res.totalSurfaced).toBe(2);
    expect(res.hitRate).toBeCloseTo(1, 6); // both of top-2 bridged
  });

  it("reports per-year accuracy so trends are visible", () => {
    const runs: HistoricalRun[] = [
      { year: 2020, surfaced: ["math \u00d7 philosophy"], scored: ["math \u00d7 philosophy"] },
      { year: 2021, surfaced: ["bio \u00d7 law"], scored: ["bio \u00d7 law"] },
    ];
    const res = retrospectiveValidate(runs, bridged, 10);
    expect(res.perYear[0]!.hitRate).toBe(1); // math×phil bridged
    expect(res.perYear[1]!.hitRate).toBe(0); // bio×law not bridged
  });

  it("handles empty history without NaN", () => {
    const res = retrospectiveValidate([], bridged, 10);
    expect(res.hitRate).toBe(0);
    expect(res.totalSurfaced).toBe(0);
    expect(res.precisionAtK).toEqual([]);
  });
});