import { FIELDS, type FlowMatrix } from "./types";
import { cosine } from "./vector";

export interface CheckResult {
  label: string;
  ok: boolean;
  detail: Record<string, unknown>;
  /** True when the check's canonical fields are absent from the run's field set. */
  skipped?: boolean;
}

/**
 * Phase-0 validation checks. Deterministic: pure functions of the flow matrix
 * and keyword maps, no I/O. A check "passing" means the data agrees with the
 * published science-of-science finding, not that the finding is true.
 *
 * V1/V2/V3 are defined over the 4 canonical fields. On a 26-field run those
 * names may be absent (e.g. Philosophy maps to Arts and Humanities) — the
 * check is then marked `skipped`, never forced to pass or fail.
 */
export function validate(
  flows: FlowMatrix,
  kws: Record<string, Record<string, number>>,
  fields: readonly string[] = FIELDS,
): CheckResult[] {
  const present = (name: string) => fields.includes(name);
  const requireFields = (names: string[]): boolean => names.every(present);

  const diag = {} as Record<string, number>;
  for (const f of fields) diag[f] = flows[f]?.[f] ?? 0;

  const v1ok = requireFields(["Mathematics", "Biology", "Sociology", "Philosophy"]);
  const mathTop = v1ok
    ? fields.reduce((best, f) => (diag[f]! > diag[best]! ? f : best), fields[0]!)
    : "";
  const v1 = {
    label: "V1: Mathematics has highest within-field citation share",
    ok: v1ok ? mathTop === "Mathematics" : false,
    skipped: !v1ok,
    detail: v1ok ? diag : { note: "canonical fields absent; check requires the 4 Phase-0 fields" },
  };

  const v2ok = requireFields(["Biology", "Sociology", "Mathematics", "Philosophy"]);
  const bioSoc = v2ok
    ? ((flows.Biology?.["Sociology"] ?? 0) + (flows.Sociology?.["Biology"] ?? 0)) / 2
    : 0;
  const mathPhi = v2ok
    ? ((flows.Mathematics?.["Philosophy"] ?? 0) + (flows.Philosophy?.["Mathematics"] ?? 0)) / 2
    : 0;
  const v2 = {
    label: "V2: Math<->Philosophy flow < Biology<->Sociology flow",
    ok: v2ok ? mathPhi < bioSoc : false,
    skipped: !v2ok,
    detail: v2ok
      ? { math_philosophy: round4(mathPhi), biology_sociology: round4(bioSoc) }
      : { note: "canonical fields absent" },
  };

  const kwGap = cosine(kws.Mathematics ?? {}, kws.Philosophy ?? {});
  const kwNear = cosine(kws.Biology ?? {}, kws.Sociology ?? {});
  const v3 = {
    label: "V3 (exploratory): keyword overlap Math/Philosophy < Biology/Sociology",
    ok: v2ok ? kwGap < kwNear : false,
    skipped: !v2ok,
    detail: v2ok
      ? { math_philosophy_kw: round4(kwGap), biology_sociology_kw: round4(kwNear) }
      : { note: "canonical fields absent" },
  };

  return [v1, v2, v3];
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}