import {
  FIELDS,
  type CitedFieldCache,
  type FlowMatrix,
  type FlowRow,
  type NormalizedFlow,
  type Work,
} from "./types";

/**
 * Build the citation-flow matrix: flow[a][b] = share of field a's *resolved*
 * outbound references landing in field b.
 *
 * Only references the pipeline actually looked up are counted: a ref is
 * "attempted" when it has an entry in the cache (value = resolved field, or
 * null = attempted but missing/deleted). Un-attempted refs carry no
 * information and are excluded from both the denominator and coverage, so a
 * bounded-resolution run does not masquerade as poor data coverage.
 *
 * `_total_refs` = attempted refs, `_total_refs_resolved` = resolved subset.
 */
export function buildFlowMatrix(
  worksByField: Record<string, Work[]>,
  citedFieldCache: CitedFieldCache,
  fields: readonly string[] = FIELDS,
): FlowMatrix {
  const flows = {} as FlowMatrix;
  for (const a of fields) {
    const counts = new Map<string, number>();
    let total = 0;
    let resolved = 0;
    for (const w of worksByField[a] ?? []) {
      for (const rid of w.referenced_works ?? []) {
        if (!citedFieldCache.has(rid)) continue;
        total += 1;
        const f = citedFieldCache.get(rid);
        if (f != null) {
          counts.set(f, (counts.get(f) ?? 0) + 1);
          resolved += 1;
        }
      }
    }
    const row = {} as FlowRow;
    for (const b of fields) row[b] = resolved ? (counts.get(b) ?? 0) / resolved : 0;
    row._total_refs = total;
    row._total_refs_resolved = resolved;
    flows[a] = row;
  }
  return flows;
}

/**
 * Normalize the flow matrix for field size and data coverage.
 *
 * - `per1k[a][b]` = estimated citations a->b per 1000 papers published in
 *   field a. Counts instead of shares, so a small field with a heavy in-group
 *   citation habit is measured against its own volume.
 * - `coverage[a]` = share of a's declared references that resolved. Low
 *   coverage means the pair's apparent sparsity may be a data artifact, not a
 *   real gap — gap scoring must suppress on this.
 *
 * Requires `sizes` = number of sampled works per field (proxy for field size
 * within the run's window).
 */
export function normalizeFlow(
  flows: FlowMatrix,
  sizes: Record<string, number>,
  fields: readonly string[] = FIELDS,
): NormalizedFlow {
  const per1k = {} as Record<string, Record<string, number>>;
  const coverage = {} as Record<string, number>;
  for (const a of fields) {
    const row = {} as Record<string, number>;
    const resolved = flows[a]?._total_refs_resolved ?? 0;
    const total = flows[a]?._total_refs ?? 0;
    for (const b of fields) {
      const count = (flows[a]?.[b] ?? 0) * resolved;
      row[b] = sizes[a] && sizes[a] > 0 ? (count / sizes[a]) * 1000 : 0;
    }
    per1k[a] = row;
    coverage[a] = total > 0 ? resolved / total : 0;
  }
  return { per1k, coverage, sizes };
}