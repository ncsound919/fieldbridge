/**
 * The 4 canonical fields from Phase 0 validation. These are the names used by
 * the Phase 0 checks; Phase 1 generalizes to the full 26-field OpenAlex
 * taxonomy via the `fields` argument on every matrix function.
 */
export const FIELDS = ["Mathematics", "Biology", "Sociology", "Philosophy"] as const;

export type FieldName = (typeof FIELDS)[number];

/** OpenAlex work record — the subset Phase 0/1 consume. */
export interface Work {
  id: string;
  referenced_works?: string[];
  abstract_inverted_index?: Record<string, number[]> | null;
}

/** Resolved field of a cited work id; `null` means the record is missing/merged/deleted. */
export type CitedFieldCache = Map<string, string | null>;

/**
 * flow[a][b] = fraction of a's resolved outbound citations landing in field b.
 * Generic over any field list (Phase 0: 4 canonical; Phase 1: 26 fields).
 */
export interface FlowRow extends Record<string, number> {
  /** All outbound references declared by field a's sample (resolved or not). */
  _total_refs: number;
  /** Outbound references that resolved to a known field (any field, incl. untracked/Unknown). */
  _total_refs_resolved: number;
  /**
   * Outbound references that resolved to one of the TRACKED fields (the
   * fields argument). Distinguished from `_total_refs_resolved` so a pair is
   * never called "disconnected" because its references resolve outside the
   * tracked universe. Present only when the matrix was built with a
   * `fields` argument (always true for the live pipeline).
   */
  _total_refs_resolved_tracked?: number;
}

export type FlowMatrix = Record<string, FlowRow>;

/** Coverage share per citing field: resolved refs / all refs. */
export type CoverageMap = Record<string, number>;

/**
 * Size-and-coverage-normalized view of the flow matrix. Per-1k-papers counts
 * stop small fields from reading as "isolation"; coverage share is the guard
 * against coverage artifacts masquerading as gaps.
 */
export interface NormalizedFlow {
  /** Estimated a->b citation count per 1000 papers in field a. */
  per1k: Record<string, Record<string, number>>;
  coverage: CoverageMap;
  sizes: Record<string, number>;
  /**
   * Per-field resolution bookkeeping for the two flow-share denominators:
   * - `allResolved`: refs resolved to ANY field.
   * - `trackedResolved`: refs resolved to one of the tracked fields.
   * A field's row of global shares sums to less than 1 exactly when
   * trackedResolved < allResolved; tracked-universe shares always sum to 1.
   */
  resolution: Record<string, { allResolved: number; trackedResolved: number }>;
}