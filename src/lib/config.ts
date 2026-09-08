/**
 * Versioned engine configuration + content hashing.
 *
 * Every metric in FieldBridge is a pure function of stored data AND this
 * config. Changing any value here bumps `version` (and therefore the config
 * hash), so re-runs are diffable and no silent tuning is possible. This is the
 * "control plane is a pure function" contract from the trend-engine spec.
 */

export interface EngineConfig {
  version: string;
  /** Works sampled per field in a run. */
  sampleSize: number;
  /** Years back over which citation flows are aggregated. */
  windowYears: number;
  /** Tokens kept per field keyword profile. */
  topKeywords: number;
  /** Coverage share below which a field's signals are treated as unreliable. */
  minCoverage: number;
  /** Minimum publication count for a field to be scored (size bias guard). */
  minPubs: number;
  /** Minimum normalized citation-gap for a pair to count as "sparse". */
  minCitationGap: number;
  /** Minimum normalized keyword-similarity growth for a pair to count as "converging". */
  minSimGrowth: number;
  /** Cross-flow share at or above which a pair is considered "dense". */
  densityNorm: number;
  /** Top-K gaps surfaced per period. */
  topK: number;
}

export const ENGINE_CONFIG: EngineConfig = {
  version: "0.2.0",
  sampleSize: 500,
  windowYears: 5,
  topKeywords: 200,
  minCoverage: 0.5,
  minPubs: 100,
  minCitationGap: 0.7,
  minSimGrowth: 0.05,
  /**
   * Cross-flow share at or above which a pair counts as "dense".
   * Calibrated from data (src/calibrate.ts, 2026-09): 0.4 maximizes
   * retrospective lift on the 2020->2023 window (1.61x) and holds up on the
   * held-out 2017->2023 window (1.29x). The hand-tuned 0.2 did NOT beat
   * random on the long-horizon window (0.94x).
   */
  densityNorm: 0.4,
  topK: 20,
};

/**
 * FNV-1a 32-bit hash. Deterministic across platforms and runtimes.
 * Used for content fingerprints / provenance chains — NOT cryptographic.
 * For tamper-evident audit chains, replace with a SHA-256 stage (see docs).
 */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Stable stringify (sorted keys) so object hashing is order-independent. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function hashObject(value: unknown): string {
  return fnv1a(stableStringify(value));
}

/** Hash a stage's inputs — the content-addressable stage fingerprint. */
export function stageHash(stage: string, inputs: unknown): string {
  return `${stage}:${hashObject(inputs)}`;
}