import { describe, expect, it } from "vitest";
import { abstractText } from "../src/lib/abstract";

describe("abstractText", () => {
  it("returns empty string for missing/empty index", () => {
    expect(abstractText(null)).toBe("");
    expect(abstractText({})).toBe("");
  });

  it("rebuilds text in correct positional order", () => {
    const idx = {
      hello: [1],
      world: [0],
      sample: [2],
    };
    expect(abstractText(idx)).toBe("world hello sample");
  });

  it("handles multi-position words", () => {
    const idx = { gene: [0, 2], flow: [1] };
    expect(abstractText(idx)).toBe("gene flow gene");
  });
});