import { describe, expect, it } from "vitest";
import { keywordCounts } from "../src/lib/keywords";
import { cosine } from "../src/lib/vector";

describe("keywordCounts", () => {
  it("filters stopwords and keeps real tokens", () => {
    const kws = keywordCounts(["The experiment with cells and tissues"]);
    expect(kws).toEqual({ experiment: 1, cells: 1, tissues: 1 });
  });

  it("excludes short and non-letter-starting tokens", () => {
    const kws = keywordCounts(["RNA-seq 5g cell 3d-multi"]);
    expect(kws["cell"]).toBe(1);
    expect(kws["rna-seq"]).toBe(1);
    expect(Object.keys(kws).some((k) => /^[^a-z]/.test(k))).toBe(false);
    expect(kws["3d-multi"]).toBeUndefined();
    expect(kws["5g"]).toBeUndefined();
  });

  it("respects topN cap, highest frequency first", () => {
    const kws = keywordCounts([Array(5).fill("alpha beta gamma delta epsilon").join(" ")], 3);
    const keys = Object.keys(kws);
    expect(keys.length).toBe(3);
    expect(keys[0]).toBe("alpha");
    expect(keys[1]).toBe("beta");
  });
});

describe("cosine", () => {
  it("returns 1.0 for identical vectors", () => {
    expect(cosine({ a: 2, b: 3 }, { a: 2, b: 3 })).toBeCloseTo(1, 10);
  });

  it("returns 0.0 for disjoint vectors", () => {
    expect(cosine({ a: 5 }, { b: 5 })).toBe(0);
  });

  it("computes partial overlap correctly", () => {
    const c = cosine({ a: 1, b: 1 }, { a: 1, c: 1 });
    expect(c).toBeCloseTo(0.5, 10);
  });

  it("returns 0.0 for empty vectors", () => {
    expect(cosine({}, { a: 1 })).toBe(0);
    expect(cosine({ a: 1 }, {})).toBe(0);
  });
});