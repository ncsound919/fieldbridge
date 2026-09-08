import { describe, expect, it } from "vitest";
import { buildFlowMatrix } from "../src/lib/matrix";
import { validate } from "../src/lib/validate";
import { FIELDS, type CitedFieldCache, type FieldName, type Work } from "../src/lib/types";

/**
 * Deterministic fixture that reproduces the Phase 0 self-test matrix
 * (p0_selftest_matrix.json): a discipline-perfect Mathematics, a mostly
 * self-citing Biology with a Sociology out-edge, a cross-wired Sociology,
 * and a self-contained Philosophy.
 */

function ref(field: FieldName, n: number): string {
  return `https://openalex.org/W-${field}-${n}`;
}

function cacheFor(field: FieldName, n: number): CitedFieldCache {
  const cache: CitedFieldCache = new Map();
  for (let i = 0; i < n; i++) cache.set(ref(field, i), field);
  return cache;
}

function worksFor(field: FieldName, refs: { field: FieldName; n: number }[]): Work[] {
  const ids: string[] = [];
  for (const r of refs) for (let i = 0; i < r.n; i++) ids.push(ref(r.field, i));
  return [{ id: `citing-${field}`, referenced_works: ids }];
}

const MATHS: Work[] = worksFor("Mathematics", [{ field: "Mathematics", n: 4 }]);
const BIOLOGY: Work[] = worksFor("Biology", [
  { field: "Biology", n: 3 },
  { field: "Sociology", n: 1 },
]);
const SOCIOLOGY: Work[] = worksFor("Sociology", [
  { field: "Biology", n: 2 },
  { field: "Sociology", n: 1 },
  { field: "Philosophy", n: 1 },
]);
const PHILOSOPHY: Work[] = worksFor("Philosophy", [{ field: "Philosophy", n: 2 }]);

const CACHE: CitedFieldCache = new Map([
  ...cacheFor("Mathematics", 4),
  ...cacheFor("Biology", 5),
  ...cacheFor("Sociology", 2),
  ...cacheFor("Philosophy", 3),
]);

const worksByField = {
  Mathematics: MATHS,
  Biology: BIOLOGY,
  Sociology: SOCIOLOGY,
  Philosophy: PHILOSOPHY,
};

describe("buildFlowMatrix", () => {
  const flows = buildFlowMatrix(worksByField, CACHE);

  it("produces the expected self-test matrix", () => {
    const expected: Record<FieldName, Record<string, number>> = {
      Mathematics: { Mathematics: 1, Biology: 0, Sociology: 0, Philosophy: 0 },
      Biology: { Mathematics: 0, Biology: 0.75, Sociology: 0.25, Philosophy: 0 },
      Sociology: { Mathematics: 0, Biology: 0.5, Sociology: 0.25, Philosophy: 0.25 },
      Philosophy: { Mathematics: 0, Biology: 0, Sociology: 0, Philosophy: 1 },
    };
    for (const f of FIELDS) {
      for (const g of FIELDS) {
        expect(flows[f]![g]).toBeCloseTo(expected[f]![g]!, 6);
      }
    }
  });

  it("tracks resolved reference totals", () => {
    expect(flows.Mathematics!._total_refs_resolved).toBe(4);
    expect(flows.Philosophy!._total_refs_resolved).toBe(2);
  });

  it("rows sum to ~1 over the four fields", () => {
    for (const f of FIELDS) {
      const sum = FIELDS.reduce((acc, g) => acc + (flows[f]![g] ?? 0), 0);
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it("excludes unresolved refs from both numerator and denominator", () => {
    const cache: CitedFieldCache = new Map([[ref("Mathematics", 0), "Mathematics"]]);
    const works: Record<FieldName, Work[]> = {
      Mathematics: [
        {
          id: "citing-math",
          referenced_works: [ref("Mathematics", 0), ref("Biology", 0), "https://openalex.org/W-deleted"],
        },
      ],
      Biology: [],
      Sociology: [],
      Philosophy: [],
    };
    const flows = buildFlowMatrix(works, cache);
    expect(flows.Mathematics!.Mathematics).toBe(1);
    expect(flows.Mathematics!._total_refs_resolved).toBe(1);
  });

  it("returns all-zero rows when nothing resolves", () => {
    const flows = buildFlowMatrix({ ...worksByField, Mathematics: [] }, new Map());
    for (const g of FIELDS) expect(flows.Mathematics![g]).toBe(0);
    expect(flows.Mathematics!._total_refs_resolved).toBe(0);
  });

  it("excludes un-attempted refs from total and coverage", () => {
    // Cache marks only ONE of the work's refs as attempted.
    const cache: CitedFieldCache = new Map([[ref("Mathematics", 0), "Mathematics"]]);
    const works: Record<FieldName, Work[]> = {
      Mathematics: [
        { id: "citing-math", referenced_works: [ref("Mathematics", 0), ref("Biology", 0)] },
      ],
      Biology: [],
      Sociology: [],
      Philosophy: [],
    };
    const flows = buildFlowMatrix(works, cache);
    expect(flows.Mathematics!._total_refs).toBe(1); // attempted, not declared
    expect(flows.Mathematics!._total_refs_resolved).toBe(1);
    expect(flows.Mathematics!.Mathematics).toBe(1);
  });
});

describe("validate", () => {
  const flows = buildFlowMatrix(worksByField, CACHE);
  const kwMath = { theorem: 10, proof: 8, topology: 5, axiom: 4 };
  const kwPhi = { meaning: 10, ethics: 8, kant: 6, proof: 1 };
  const kwBio = { cell: 10, gene: 9, organism: 8, population: 5, tissue: 4 };
  const kwSoc = { cell: 5, population: 8, social: 9, network: 7, institution: 6 };
  const kws = { Mathematics: kwMath, Biology: kwBio, Sociology: kwSoc, Philosophy: kwPhi };

  const checks = validate(flows, kws);

  it("V1 passes: Mathematics has highest within-field share", () => {
    const v1 = checks[0]!;
    expect(v1.ok).toBe(true);
    expect(v1.detail.Mathematics).toBe(1);
  });

  it("V2 passes: Math<->Philosophy flow < Biology<->Sociology flow", () => {
    const v2 = checks[1]!;
    expect(v2.ok).toBe(true);
    expect(v2.detail).toMatchObject({ math_philosophy: 0, biology_sociology: 0.375 });
  });

  it("V3 passes: keyword overlap Math/Philosophy < Biology/Sociology", () => {
    const v3 = checks[2]!;
    expect(v3.ok).toBe(true);
  });

  it("returns labels for all three checks", () => {
    expect(checks.map((c) => c.label)).toHaveLength(3);
  });
});