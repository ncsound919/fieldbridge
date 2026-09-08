/**
 * Retrospective validation harness — the credibility artifact.
 *
 * Institutions will not pay for "gaps" with no demonstrated hit-rate. This
 * module answers the only question that matters: *of the gaps we surfaced in
 * year T, how many were actually bridged by year T+k?* It is a pure function
 * of (historical scored gaps, future ground truth) — no fabrication, no
 * calibrated optimism.
 *
 * The pipeline runs this on real snapshots:
 *   - score gaps on a past window (e.g. 2019-2021 data),
 *   - mark "bridged" pairs that by the later window acquired real cross-flow,
 *   - measure precision@k / hit-rate.
 */

export interface HistoricalRun {
  year: number;
  /** Pair keys that were surfaced (top-K) that year. */
  surfaced: string[];
  /** Pair keys that were scored but not surfaced (audit). */
  scored: string[];
}

export interface ValidationResult {
  /** Precision over the union of surfaced gaps across all historical years. */
  hitRate: number;
  precisionAtK: number[];
  totalSurfaced: number;
  totalScored: number;
  bridgedCount: number;
  /** Per-year detail, so trends in accuracy are visible, not averaged away. */
  perYear: Array<{ year: number; surfaced: number; bridged: number; hitRate: number }>;
}

/**
 * @param runs         chronological list of scored/surfaced gap runs.
 * @param bridgedPairs set of pair keys that acquired real cross-flow by the
 *                     future horizon (ground truth).
 * @param topK         pairs ranked as surfaced per year.
 */
export function retrospectiveValidate(
  runs: HistoricalRun[],
  bridgedPairs: ReadonlySet<string>,
  topK: number,
): ValidationResult {
  const perYear = runs.map((r) => {
    const surfaced = rankPairs(r, topK);
    const bridged = surfaced.filter((p) => bridgedPairs.has(p));
    return {
      year: r.year,
      surfaced: surfaced.length,
      bridged: bridged.length,
      hitRate: surfaced.length > 0 ? bridged.length / surfaced.length : 0,
    };
  });

  const allSurfaced = new Set<string>();
  for (const r of runs) for (const p of rankPairs(r, topK)) allSurfaced.add(p);
  const totalSurfaced = allSurfaced.size;

  const ranked = [...allSurfaced];
  const precisionAtK: number[] = [];
  let hits = 0;
  for (let k = 0; k < ranked.length; k++) {
    if (bridgedPairs.has(ranked[k]!)) hits += 1;
    precisionAtK.push(hits / (k + 1));
  }

  const totalScored = new Set<string>();
  for (const r of runs) for (const p of r.scored) totalScored.add(p);

  return {
    hitRate: totalSurfaced > 0 ? hits / totalSurfaced : 0,
    precisionAtK,
    totalSurfaced,
    totalScored: totalScored.size,
    bridgedCount: hits,
    perYear,
  };
}

function rankPairs(run: HistoricalRun, topK: number): string[] {
  return run.surfaced.slice(0, topK);
}