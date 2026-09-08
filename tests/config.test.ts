import { describe, expect, it } from "vitest";
import { ENGINE_CONFIG, fnv1a, hashObject, stageHash, stableStringify } from "../src/lib/config";

describe("config hashing", () => {
  it("fnv1a is deterministic and stable", () => {
    expect(fnv1a("fieldbridge")).toBe(fnv1a("fieldbridge"));
    expect(fnv1a("a")).not.toBe(fnv1a("b"));
  });

  it("stableStringify is key-order independent", () => {
    const a = { b: 1, a: 2, c: [1, { x: 1 }] };
    const b = { c: [1, { x: 1 }], a: 2, b: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("hashObject fingerprints identical content identically", () => {
    expect(hashObject(ENGINE_CONFIG)).toBe(hashObject(ENGINE_CONFIG));
  });

  it("config changes produce different hashes (no silent tuning)", () => {
    const base = hashObject(ENGINE_CONFIG);
    const mutated = hashObject({ ...ENGINE_CONFIG, topKeywords: 201 });
    expect(mutated).not.toBe(base);
  });

  it("stageHash binds stage name to inputs", () => {
    expect(stageHash("flow", { a: 1 })).not.toBe(stageHash("keywords", { a: 1 }));
  });
});