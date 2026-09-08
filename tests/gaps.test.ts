import { describe, expect, it } from "vitest";
import { ENGINE_CONFIG, type EngineConfig } from "../src/lib/config";
import {
  allPairs,
  normSimGrowth,
  rankGaps,
  scorePairs,
  type PairSignals,
} from "../src/lib/gaps";
import type { FieldName } from "../src/lib/types";

const OK_COVERAGE: [number, number] = [0.9, 0.9];
const OK_SIZE: [number, number] = [1000, 1000];

function pair(a: FieldName, b: FieldName, overrides: Partial<PairSignals> = {}): PairSignals {
  return {
    a,
    b,
    crossFlow: 0.01,
    kwSim: 0.2,
    kwSimPrior: 0.1,
    coverage: OK_COVERAGE,
    sizes: OK_SIZE,
    ...overrides,
  };
}

describe("normSimGrowth", () => {
  it("clamps negative growth to 0", () => {
    expect(normSimGrowth(-0.5, ENGINE_CONFIG)).toBe(0);
  });
  it("clamps large growth to 1", () => {
    expect(normSimGrowth(5, ENGINE_CONFIG)).toBe(1);
  });
  it("maps growth onto a config-driven reference scale", () => {
    // reference = densityNorm * 2; growth normalized against it.
    const ref = ENGINE_CONFIG.densityNorm * 2;
    expect(normSimGrowth(0.1, ENGINE_CONFIG)).toBeCloseTo(0.1 / ref, 6);
  });
});

describe("scorePairs / dual-signal rule", () => {
  it("surfaces a true gap (sparse citation flow + converging keywords)", () => {
    const [g] = scorePairs([pair("Mathematics", "Philosophy")], ENGINE_CONFIG);
    expect(g!.surfaced).toBe(true);
    expect(g!.dualAgree).toBe(true);
    expect(g!.citationGap).toBeGreaterThanOrEqual(ENGINE_CONFIG.minCitationGap);
    expect(g!.simGrowth).toBeGreaterThanOrEqual(ENGINE_CONFIG.minSimGrowth);
  });

  it("suppresses when keywords are NOT converging (no semantic pull)", () => {
    const [g] = scorePairs(
      [pair("Mathematics", "Philosophy", { kwSim: 0.105, kwSimPrior: 0.1 })],
      ENGINE_CONFIG,
    );
    expect(g!.surfaced).toBe(false);
    expect(g!.suppressedFor).toContain("signals_disagree");
  });

  it("suppresses when citation flow is not actually sparse", () => {
    const [g] = scorePairs(
      [pair("Mathematics", "Philosophy", { crossFlow: 0.9 })],
      ENGINE_CONFIG,
    );
    expect(g!.surfaced).toBe(false);
    expect(g!.suppressedFor).toContain("signals_disagree");
  });

  it("suppresses low-coverage pairs before any signal is trusted", () => {
    const [g] = scorePairs(
      [pair("Mathematics", "Philosophy", { coverage: [0.9, 0.2] })],
      ENGINE_CONFIG,
    );
    expect(g!.surfaced).toBe(false);
    expect(g!.suppressedFor).toContain("coverage_below_threshold");
  });

  it("suppresses pairs where either field is too small", () => {
    const [g] = scorePairs(
      [pair("Mathematics", "Philosophy", { sizes: [1000, 12] })],
      ENGINE_CONFIG,
    );
    expect(g!.surfaced).toBe(false);
    expect(g!.suppressedFor).toContain("field_below_min_pubs");
  });

  it("scores every pair for audit even when suppressed", () => {
    const suppressed = scorePairs(
      [pair("Mathematics", "Philosophy", { kwSim: 0.101, kwSimPrior: 0.1 })],
      ENGINE_CONFIG,
    );
    expect(suppressed[0]!.score).toBeGreaterThan(0); // score still computed
  });
});

describe("rankGaps", () => {
  it("ranks surfaced gaps descending by score and clips to topK", () => {
    const scores = [
      pair("Mathematics", "Philosophy", { kwSim: 0.2, kwSimPrior: 0.1 }), // growth 0.1
      pair("Biology", "Sociology", { kwSim: 0.3, kwSimPrior: 0.1 }), // growth 0.2 -> higher score
      pair("Biology", "Philosophy", { kwSim: 0.101, kwSimPrior: 0.1 }), // suppressed
    ];
    const scored = scorePairs(scores, ENGINE_CONFIG);
    const ranked = rankGaps(scored, 2);
    expect(ranked.map((g) => g.pair)).toEqual(["Biology \u00d7 Sociology", "Mathematics \u00d7 Philosophy"]);
    expect(ranked.length).toBe(2);
  });
});

describe("allPairs", () => {
  it("enumerates unordered pairs over the field set", () => {
    const pairs = allPairs(["Mathematics", "Biology", "Sociology"] as FieldName[]);
    expect(pairs).toEqual([
      ["Mathematics", "Biology"],
      ["Mathematics", "Sociology"],
      ["Biology", "Sociology"],
    ]);
  });
});

describe("config sensitivity", () => {
  it("looser minSimGrowth surfaces pairs a stricter config suppresses", () => {
    const looser: EngineConfig = { ...ENGINE_CONFIG, minSimGrowth: 0.005 };
    const signals = pair("Mathematics", "Philosophy", { kwSim: 0.105, kwSimPrior: 0.1 });
    const strict = scorePairs([signals], ENGINE_CONFIG);
    const loose = scorePairs([signals], looser);
    expect(strict[0]!.surfaced).toBe(false);
    expect(loose[0]!.surfaced).toBe(true);
  });
});