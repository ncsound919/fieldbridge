import { describe, expect, it } from "vitest";
import { buildFlowMatrix, normalizeFlow } from "../src/lib/matrix";
import { FIELDS, type CitedFieldCache, type FieldName, type Work } from "../src/lib/types";

function ref(field: FieldName, n: number): string {
  return `https://openalex.org/W-${field}-${n}`;
}

function makeWorks(rows: { field: FieldName; to: FieldName; n: number }[]): Work[] {
  const refs: string[] = [];
  for (const r of rows) for (let i = 0; i < r.n; i++) refs.push(ref(r.to, i));
  return [{ id: `citing-${rows[0]?.field}`, referenced_works: refs }];
}

function cacheFor(...fields: FieldName[]): CitedFieldCache {
  const c: CitedFieldCache = new Map();
  let i = 0;
  for (const f of fields) c.set(ref(f, i++), f);
  return c;
}

describe("normalizeFlow", () => {
  it("computes per-1k counts and coverage shares", () => {
    // Mathematics: 4 refs all resolved to Math. 2000 papers sampled.
    // Biology: 3 refs to Bio, 1 to Sociology, 4th ref unresolved (deleted).
    const works = {
      Mathematics: makeWorks([{ field: "Mathematics", to: "Mathematics", n: 4 }]),
      Biology: makeWorks([
        { field: "Biology", to: "Biology", n: 2 },
        { field: "Biology", to: "Sociology", n: 1 },
      ]),
      Sociology: [],
      Philosophy: [],
    };
    const cache: CitedFieldCache = new Map([
      [ref("Mathematics", 0), "Mathematics"],
      [ref("Mathematics", 1), "Mathematics"],
      [ref("Mathematics", 2), "Mathematics"],
      [ref("Mathematics", 3), "Mathematics"],
      [ref("Biology", 0), "Biology"],
      [ref("Biology", 1), "Biology"],
      [ref("Sociology", 0), "Sociology"],
      // Attempted but unresolved (deleted/merged record): explicit null.
      ["https://openalex.org/W-deleted", null],
    ]);
    // Biology: 2 refs to Bio, 1 to Sociology, 1 attempted-but-unresolved.
    // coverage = 3 resolved / 4 attempted = 0.75. The un-attempted-ref
    // case is covered by buildFlowMatrix tests (matrix.test.ts).
    works.Biology[0]!.referenced_works!.push("https://openalex.org/W-deleted");
    const flows = buildFlowMatrix(works, cache);
    const sizes = { Mathematics: 2000, Biology: 1000, Sociology: 500, Philosophy: 500 };
    const n = normalizeFlow(flows, sizes);

    // Mathematics: 4 resolved refs over 2000 papers -> 4/2000*1000 = 2 per-1k.
    expect(n.per1k.Mathematics!.Mathematics).toBeCloseTo(2, 6);
    // Biology coverage: 3 resolved / 4 declared = 0.75.
    expect(n.coverage.Biology).toBeCloseTo(0.75, 6);
    expect(n.coverage.Mathematics).toBeCloseTo(1, 6);
    expect(n.sizes).toEqual(sizes);
  });

  it("flags zero coverage when no refs resolve", () => {
    const empty = buildFlowMatrix(
      {
        Mathematics: makeWorks([{ field: "Mathematics", to: "Mathematics", n: 3 }]),
        Biology: [],
        Sociology: [],
        Philosophy: [],
      },
      new Map(), // nothing resolves
    );
    const n = normalizeFlow(empty, { Mathematics: 1, Biology: 1, Sociology: 1, Philosophy: 1 });
    expect(n.coverage.Mathematics).toBe(0);
    // All flows are 0 (denominator 0), so per-1k is 0 even with papers present.
    expect(n.per1k.Mathematics!.Mathematics).toBe(0);
  });
});