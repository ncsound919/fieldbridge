import { describe, expect, it } from "vitest";
import { ENGINE_CONFIG } from "../src/lib/config.js";
import {
  baselineRankings,
  buildBenchmarkPairs,
  pairBootstrapLift,
  rollingOriginBenchmark,
  type BenchmarkPair,
  type BenchmarkWindow,
  type PairSignals,
} from "../src/lib/index.js";

function signals(a: string, b: string, over: Partial<PairSignals>): PairSignals {
  return {
    a,
    b,
    crossFlow: 0.01,
    kwSim: 0.3,
    kwSimPrior: 0.2,
    coverage: [0.8, 0.8],
    sizes: [120, 120],
    ...over,
  };
}

describe("buildBenchmarkPairs", () => {
  it("computes simGrowth, crossFlowGrowth, score, and surface flags", () => {
    const pairs = buildBenchmarkPairs(
      [signals("A", "B", { crossFlow: 0.005, crossFlowPrior: 0.05, kwSim: 0.4, kwSimPrior: 0.2 })],
      ENGINE_CONFIG,
    );
    const p = pairs[0]!;
    expect(p.simGrowth).toBeCloseTo(0.2, 6);
    expect(p.crossFlowGrowth).toBeCloseTo(-0.045, 6);
    expect(p.surfaced).toBe(true); // sparse + converging, adequate coverage/size
    expect(p.pair).toBe("A × B");
  });
});

describe("baselineRankings", () => {
  it("returns deterministic top-K for every strategy", () => {
    const pairs = buildBenchmarkPairs(
      Array.from({ length: 40 }, (_, i) =>
        signals(`F${i % 5}`, `G${i % 4}`, { crossFlow: i / 100, kwSim: 0.1 + i / 100, kwSimPrior: 0.05 }),
      ),
      ENGINE_CONFIG,
    );
    const r1 = baselineRankings(pairs, ENGINE_CONFIG, 10);
    const r2 = baselineRankings(pairs, ENGINE_CONFIG, 10);
    expect(r1).toEqual(r2);
    for (const strategy of Object.keys(r1)) {
      expect(r1[strategy as keyof typeof r1].length).toBe(10);
    }
  });

  it("lowest-crossflow selects the most sparse pairs", () => {
    const pairs = buildBenchmarkPairs(
      [
        signals("A", "B", { crossFlow: 0.001 }),
        signals("A", "C", { crossFlow: 0.5 }),
        signals("B", "C", { crossFlow: 0.9 }),
      ],
      ENGINE_CONFIG,
    );
    const top = baselineRankings(pairs, ENGINE_CONFIG, 2)["lowest-crossflow"];
    expect(top[0]).toBe("A × B");
  });
});

describe("pairBootstrapLift", () => {
  it("a perfect predictor has lift 2.0 with CI well above 1.0", () => {
    // 200 eligible pairs: all sparse + converging (surface-eligible), 100
    // bridged. Bridged pairs get much higher keyword-sim growth so they rank
    // top-K; base rate over the eligible population = 0.5 -> lift ~2.0.
    const pairs: BenchmarkPair[] = [];
    const bridged = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const isBridged = i < 100;
      const key = `F${i} × G${i}`;
      if (isBridged) bridged.add(key);
      pairs.push(
        buildBenchmarkPairs(
          [
            signals(`F${i}`, `G${i}`, {
              crossFlow: 0.001,
              kwSim: isBridged ? 0.95 : 0.09,
              kwSimPrior: 0,
            }),
          ],
          ENGINE_CONFIG,
        )[0]!,
      );
    }
    const { lift } = pairBootstrapLift(pairs, bridged, 10, { b: 500, seed: 1 });
    expect(lift.mean).toBeGreaterThan(1.5);
    expect(lift.lower).toBeGreaterThan(1.0);
  });

  it("is deterministic for a fixed seed", () => {
    const pairs = buildBenchmarkPairs(
      Array.from({ length: 30 }, (_, i) => signals(`F${i % 6}`, `G${i % 5}`, { crossFlow: i / 100 })),
      ENGINE_CONFIG,
    );
    const bridged = new Set(pairs.slice(0, 8).map((p) => p.pair));
    const a = pairBootstrapLift(pairs, bridged, 10, { b: 100, seed: 42 });
    const b = pairBootstrapLift(pairs, bridged, 10, { b: 100, seed: 42 });
    expect(a).toEqual(b);
  });
});

describe("rollingOriginBenchmark", () => {
  function makeWindow(
    current: number,
    prior: number,
    horizon: number,
    heldOut: boolean,
    pairs: BenchmarkPair[],
    bridgedPairs: string[],
  ): BenchmarkWindow {
    return {
      current,
      prior,
      horizon,
      heldOut,
      calibrationWindow: !heldOut,
      pairs,
      bridged: new Set(bridgedPairs),
    };
  }

  it("verdict is PENDING when fewer than 2 held-out windows exist", () => {
    const pairs = buildBenchmarkPairs(
      Array.from({ length: 40 }, (_, i) => signals(`F${i % 5}`, `G${i % 4}`, { crossFlow: i / 100 })),
      ENGINE_CONFIG,
    );
    const res = rollingOriginBenchmark(
      [
        makeWindow(2017, 2014, 2020, true, pairs, pairs.slice(0, 5).map((p) => p.pair)),
        makeWindow(2020, 2017, 2023, false, pairs, pairs.slice(0, 5).map((p) => p.pair)),
      ],
      ENGINE_CONFIG,
      10,
    );
    expect(res.verdict.state).toBe("PENDING");
    expect(res.verdict.passed).toBe(false);
  });

  it("reports pooled held-out metrics and baselines per window", () => {
    const pairs = buildBenchmarkPairs(
      Array.from({ length: 40 }, (_, i) => signals(`F${i % 5}`, `G${i % 4}`, { crossFlow: i / 100 })),
      ENGINE_CONFIG,
    );
    const res = rollingOriginBenchmark(
      [makeWindow(2017, 2014, 2020, true, pairs, pairs.slice(0, 3).map((p) => p.pair))],
      ENGINE_CONFIG,
      10,
    );
    expect(res.windows[0]!.baselines.length).toBeGreaterThanOrEqual(8);
    expect(res.pooled).not.toBeNull();
    expect(res.windows[0]!.liftCI).not.toBeNull();
  });
});