/**
 * Canonical interdisciplinarity indices — the metrics institutional evaluators
 * recognize (Rao-Stirling, Leydesdorff DIV, Shannon, Simpson, Gini).
 *
 * FieldBridge becomes credible to research offices ("transparent SciVal on
 * open data") by publishing these standard indices computed on open data,
 * with uncertainty bounds — the thing the entrenched products do NOT do
 * (their methods are proprietary).
 *
 * Definitions (disclosed exactly as implemented):
 *  - p_i = share of unit a's references in tracked category i, RENORMALIZED
 *    over the tracked universe (flow rows sum to <1 when references resolve
 *    outside the tracked set; see matrix.ts).
 *  - disparity d_ij = 1 - cosine(row_i, row_j), where row_i is the reference
 *    distribution of category i over the tracked universe (Porter/Rafols-style
 *    citation-based similarity using our own matrix).
 *  - Rao-Stirling (RS) = sum_{i,j} p_i p_j d_ij (Stirling 2007).
 *  - DIV (Leydesdorff/Wagner/Bornmann, JOI 2019):
 *      DIV = variety x balance x disparity,
 *      variety = n/N (n = distinct categories referenced, N = tracked size),
 *      balance = 1 - Gini(observed non-zero shares),
 *      disparity = mean pairwise d_ij over observed categories (unweighted).
 *  - Shannon H = -sum p ln p (natural log); Simpson = 1 - sum p^2;
 *    Gini over observed non-zero shares.
 *  - bootstrap CI for RS follows the Scientometrics 2023 method: resample the
 *    unit's reference multiset with replacement, recompute RS each draw.
 *
 * All functions are pure (no I/O) and deterministic under a fixed seed.
 */

import type { FlowMatrix } from "./types";

export interface DiversityProfile {
  unit: string;
  /** Distinct categories referenced (n). */
  n: number;
  /** Tracked-universe size (N). */
  N: number;
  /** Relative variety n/N. */
  variety: number;
  /** 1 - Gini over observed shares. */
  balance: number;
  /** Mean pairwise disparity over observed categories. */
  disparity: number;
  raoStirling: number;
  div: number;
  shannon: number;
  simpson: number;
  gini: number;
  /** Total resolved references backing the distribution. */
  refs: number;
}

/** Reference shares of unit a renormalized over the tracked universe. */
export function referenceShares(
  flows: FlowMatrix,
  a: string,
  categories: readonly string[],
): Record<string, number> {
  const raw: Record<string, number> = {};
  let sum = 0;
  for (const c of categories) {
    const v = flows[a]?.[c] ?? 0;
    raw[c] = v;
    sum += v;
  }
  if (sum <= 0) return Object.fromEntries(categories.map((c) => [c, 0]));
  return Object.fromEntries(categories.map((c) => [c, raw[c]! / sum]));
}

function profileVector(flows: FlowMatrix, c: string, categories: readonly string[]): number[] {
  return categories.map((k) => flows[c]?.[k] ?? 0);
}

function cosineVec(x: number[], y: number[]): number {
  let dot = 0;
  let nx = 0;
  let ny = 0;
  for (let i = 0; i < x.length; i++) {
    dot += x[i]! * y[i]!;
    nx += x[i]! * x[i]!;
    ny += y[i]! * y[i]!;
  }
  if (nx === 0 || ny === 0) return 0;
  return dot / Math.sqrt(nx * ny);
}

/** Disparity d_ij = 1 - cosine(profile_i, profile_j) over the tracked universe. */
export function disparityMatrix(
  flows: FlowMatrix,
  categories: readonly string[],
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  const vecs = new Map(categories.map((c) => [c, profileVector(flows, c, categories)]));
  for (const i of categories) {
    out[i] = {};
    for (const j of categories) {
      out[i]![j] = 1 - cosineVec(vecs.get(i)!, vecs.get(j)!);
    }
  }
  return out;
}

export function gini(values: number[]): number {
  const xs = [...values].filter((v) => v > 0).sort((a, b) => a - b);
  const n = xs.length;
  if (n <= 1) return 0;
  const sum = xs.reduce((s, v) => s + v, 0);
  if (sum <= 0) return 0;
  let cum = 0;
  let num = 0;
  for (let i = 0; i < n; i++) {
    cum += xs[i]!;
    num += (n - i) * xs[i]!;
  }
  return (n + 1 - (2 * num) / sum) / n;
}

export function raoStirling(
  shares: Record<string, number>,
  categories: readonly string[],
  disparity: Record<string, Record<string, number>>,
): number {
  let rs = 0;
  for (const i of categories) {
    const pi = shares[i] ?? 0;
    if (pi === 0) continue;
    for (const j of categories) {
      const pj = shares[j] ?? 0;
      if (pj === 0) continue;
      rs += pi * pj * (disparity[i]?.[j] ?? 1);
    }
  }
  return rs;
}

/** Shannon entropy (natural log) over a share distribution. */
export function shannon(
  shares: Record<string, number>,
  categories: readonly string[],
): number {
  let h = 0;
  for (const c of categories) {
    const p = shares[c] ?? 0;
    if (p > 0) h -= p * Math.log(p);
  }
  return h;
}

/** Simpson diversity 1 - sum p^2. */
export function simpson(
  shares: Record<string, number>,
  categories: readonly string[],
): number {
  let s = 0;
  for (const c of categories) s += (shares[c] ?? 0) ** 2;
  return 1 - s;
}

export function diversityOf(
  flows: FlowMatrix,
  unit: string,
  categories: readonly string[],
): DiversityProfile {
  const shares = referenceShares(flows, unit, categories);
  const observed = categories.filter((c) => (shares[c] ?? 0) > 0);
  const n = observed.length;
  const N = categories.length;
  const disparity = disparityMatrix(flows, categories);

  let pairSum = 0;
  let pairCount = 0;
  for (let i = 0; i < observed.length; i++) {
    for (let j = i + 1; j < observed.length; j++) {
      pairSum += disparity[observed[i]!]![observed[j]!] ?? 1;
      pairCount += 1;
    }
  }
  const meanDisparity = pairCount > 0 ? pairSum / pairCount : 0;

  const variety = N > 0 ? n / N : 0;
  const g = gini(observed.map((c) => shares[c]!));
  const balance = 1 - g;
  const rs = raoStirling(shares, categories, disparity);

  let shannon = 0;
  let simpsonSum = 0;
  for (const c of observed) {
    const p = shares[c]!;
    shannon -= p * Math.log(p);
    simpsonSum += p * p;
  }
  const refs = flows[unit]?._total_refs_resolved ?? 0;
  return {
    unit,
    n,
    N,
    variety: round6(variety),
    balance: round6(balance),
    disparity: round6(meanDisparity),
    raoStirling: round6(rs),
    div: round6(variety * balance * meanDisparity),
    shannon: round6(shannon),
    simpson: round6(1 - simpsonSum),
    gini: round6(g),
    refs,
  };
}

/**
 * Bootstrap 95% CI for a unit's Rao-Stirling score (Scientometrics 2023
 * method): resample the resolved-reference multiset with replacement, rebuild
 * shares, recompute RS. Deterministic under a fixed seed.
 */
export function bootstrapRaoStirling(
  flows: FlowMatrix,
  unit: string,
  categories: readonly string[],
  options: { draws?: number; seed?: number } = {},
): { lower: number; upper: number; mean: number; median: number } {
  const draws = options.draws ?? 500;
  const rnd = mulberry32(options.seed ?? 0xfb);
  const resolved = Math.round(flows[unit]?._total_refs_resolved ?? 0);
  const shares = referenceShares(flows, unit, categories);
  const disparity = disparityMatrix(flows, categories);
  const cum: Array<[string, number]> = [];
  let acc = 0;
  for (const c of categories) {
    acc += shares[c] ?? 0;
    cum.push([c, acc]);
  }
  const pick = (): string => {
    const r = rnd();
    for (const [c, edge] of cum) if (r <= edge) return c;
    return categories[categories.length - 1]!;
  };
  const vals: number[] = [];
  if (resolved > 0) {
    for (let d = 0; d < draws; d++) {
      const counts = new Map<string, number>();
      for (let i = 0; i < resolved; i++) {
        const c = pick();
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      const p: Record<string, number> = {};
      for (const c of categories) p[c] = (counts.get(c) ?? 0) / resolved;
      vals.push(raoStirling(p, categories, disparity));
    }
  }
  if (vals.length === 0) return { lower: 0, upper: 0, mean: 0, median: 0 };
  vals.sort((a, b) => a - b);
  return {
    lower: round6(vals[Math.floor(draws * 0.025)] ?? 0),
    upper: round6(vals[Math.min(vals.length - 1, Math.ceil(draws * 0.975))] ?? 0),
    mean: round6(vals.reduce((s, v) => s + v, 0) / vals.length),
    median: round6(vals[Math.floor(vals.length / 2)] ?? 0),
  };
}

/** RS delta (current minus prior) per unit — feeds the diversity-growth baseline. */
export function diversityDelta(cur: DiversityProfile, prior: DiversityProfile): number {
  return round6(cur.raoStirling - prior.raoStirling);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}