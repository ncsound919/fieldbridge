import { describe, expect, it } from "vitest";
import {
  buildPairSeries,
  closingRank,
  emergingRank,
  relativeGrowth,
  type PairSeries,
} from "../src/lib/trends";

describe("relativeGrowth", () => {
  it("measures relative change across a window", () => {
    expect(relativeGrowth([1, 2, 4])).toBe(3); // (4-1)/1
    expect(relativeGrowth([2, 3])).toBeCloseTo(0.5, 6);
  });

  it("is 0 for flat or degenerate series", () => {
    expect(relativeGrowth([5, 5])).toBe(0);
    expect(relativeGrowth([1])).toBe(0);
    expect(relativeGrowth([])).toBe(0);
  });

  it("handles zero start (closing from nothing) honestly", () => {
    expect(relativeGrowth([0, 0, 0.4])).toBe(1); // capped
    expect(relativeGrowth([0, 0, 0])).toBe(0);
  });
});

const YEARS = [2018, 2020, 2023];

// cross-flow map keyed by "a × b" sorted-pair key.
const key = (a: string, b: string) => [a, b].sort().join(" \u00d7 ");

describe("buildPairSeries", () => {
  it("assembles per-year series deterministically", () => {
    const cross = { [2018]: { [key("Math", "Bio")]: 0.01 }, [2020]: { [key("Math", "Bio")]: 0.02 }, [2023]: { [key("Math", "Bio")]: 0.05 } };
    const kw = { [2018]: { [key("Math", "Bio")]: 0.2 }, [2020]: { [key("Math", "Bio")]: 0.25 }, [2023]: { [key("Math", "Bio")]: 0.3 } };
    const series = buildPairSeries(YEARS, cross, kw, new Set(), [["Math", "Bio"]]);
    expect(series[0]!.crossFlow).toEqual([0.01, 0.02, 0.05]);
    expect(series[0]!.kwSim).toEqual([0.2, 0.25, 0.3]);
    expect(series[0]!.surfacedAtBaseline).toBe(false);
  });

  it("marks baseline-surfaced pairs", () => {
    const s = buildPairSeries(YEARS, {}, {}, new Set([key("Math", "Bio")]), [["Math", "Bio"]]);
    expect(s[0]!.surfacedAtBaseline).toBe(true);
  });
});

describe("closingRank", () => {
  it("ranks surfaced pairs by cross-flow closing speed", () => {
    const AB = key("A", "B");
    const CD = key("C", "D");
    // A×B grows slowly (0.01 -> 0.013); C×D grows fast (0.01 -> 0.06).
    const cross = {
      [2018]: { [AB]: 0.01, [CD]: 0.01 },
      [2020]: { [AB]: 0.012, [CD]: 0.03 },
      [2023]: { [AB]: 0.013, [CD]: 0.06 },
    };
    const series = buildPairSeries(
      YEARS,
      cross,
      {},
      new Set([AB, CD]),
      [["A", "B"], ["C", "D"]],
    );
    const ranked = closingRank(series);
    expect(ranked[0]!.pair).toBe(CD); // 0.01 -> 0.06
    expect(ranked[0]!.closingRate).toBeCloseTo(5, 6);
    expect(ranked[1]!.pair).toBe(AB);
  });

  it("excludes pairs that were never surfaced at baseline", () => {
    const series = buildPairSeries(YEARS, {}, {}, new Set(), [["A", "B"]]);
    expect(closingRank(series)).toEqual([]);
  });
});

describe("emergingRank", () => {
  const K = key("X", "Y");
  const flow = (v: number) => ({ [K]: v });
  const sim = (v: number) => ({ [K]: v });

  it("ranks keyword-converging sparse pairs, excluding bridged ones", () => {
    const emerging: PairSeries = {
      a: "X",
      b: "Y",
      pair: key("X", "Y"),
      years: YEARS,
      crossFlow: [0.001, 0.001, 0.001],
      kwSim: [0.1, 0.2, 0.4],
      surfacedAtBaseline: true,
    };
    const bridged: PairSeries = {
      ...emerging,
      crossFlow: [0.001, 0.05, 0.3], // ends above densityNorm -> not "emerging"
    };
    const ranked = emergingRank([emerging, bridged], 0.2);
    expect(ranked.length).toBe(1);
    expect(ranked[0]!.kwSimGrowth).toBeCloseTo(3, 6);
  });

  it("emergenceScore = kwSimGrowth * sparsity", () => {
    const s: PairSeries = {
      a: "A",
      b: "B",
      pair: key("A", "B"),
      years: YEARS,
      crossFlow: [0.001, 0.001, 0.001],
      kwSim: [0.1, 0.1, 0.2],
      surfacedAtBaseline: false,
    };
    const [e] = emergingRank([s], 0.2);
    // kwSimGrowth=1, sparsity = 1 - 0.001/0.2 ≈ 0.995 -> ~0.995
    expect(e!.emergenceScore).toBeCloseTo(0.995, 2);
  });
});