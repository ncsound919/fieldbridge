/**
 * Dual-signal gap scoring engine.
 *
 * A "gap" between fields a and b is surfaced ONLY when two independent
 * signals agree:
 *
 *   1. citation gap  — normalized cross-flow is sparse (below densityNorm);
 *   2. sim growth    — semantic/keyword profiles are converging over time.
 *
 * This dual-agreement rule is the guard against false positives: a pair that
 * is merely underexplored (no semantic pull) or merely similar (no citation
 * deficit) is not a gap. Scores are computed for EVERY pair for audit, but
 * only agreeing, unsuppressed pairs are surfaced. Nothing here touches I/O.
 */

import type { EngineConfig } from "./config";
import { FIELDS } from "./types";

export interface PairSignals {
  a: string;
  b: string;
  /** Symmetric normalized cross-flow share (a<->b), 0 = no citation traffic. */
  crossFlow: number;
  /** Keyword-profile cosine at the current period. */
  kwSim: number;
  /** Keyword-profile cosine at the prior period (growth baseline). */
  kwSimPrior: number;
  /** Symmetric normalized cross-flow share at the prior period (momentum baseline). */
  crossFlowPrior?: number;
  /** Coverage share for each field (from normalizeFlow). */
  coverage: [number, number];
  /** Sampled publication counts for each field (size guard). */
  sizes: [number, number];
}

export interface GapScore {
  pair: string;
  /** norm(simGrowth) * (1 - norm(citationDensity)); higher = more actionable. */
  score: number;
  /** Normalized citation-gap, 0..1 (1 = maximally sparse). */
  citationGap: number;
  /** Normalized similarity growth, 0..1 (1 = converging fast). */
  simGrowth: number;
  /** Both signals cleared their thresholds. */
  dualAgree: boolean;
  /** Whether the pair is safe to surface under coverage/size guards. */
  surfaced: boolean;
  /** Reasons the pair was suppressed (empty when surfaced). */
  suppressedFor: string[];
  crossFlow: number;
  kwSim: number;
  kwSimPrior: number;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join(" \u00d7 ");
}

/** Symmetric cross-flow share between a and b. */
export function crossFlowOf(
  flows: Record<string, Record<string, number>>,
  a: string,
  b: string,
): number {
  return ((flows[a]?.[b] ?? 0) + (flows[b]?.[a] ?? 0)) / 2;
}

/** Normalize similarity growth so the config threshold is on a stable scale. */
export function normSimGrowth(growth: number, cfg: EngineConfig): number {
  // growth is unbounded cosine delta; clamp below 0 and normalize by a
  // config-driven reference so minSimGrowth is interpretable.
  const ref = cfg.densityNorm * 2;
  return Math.max(0, Math.min(1, growth / ref));
}

export function scorePairs(
  pairs: PairSignals[],
  cfg: EngineConfig,
): GapScore[] {
  return pairs.map((p) => {
    const citationGap = Math.max(0, Math.min(1, 1 - p.crossFlow / cfg.densityNorm));
    const simGrowth = normSimGrowth(p.kwSim - p.kwSimPrior, cfg);
    const score = simGrowth * citationGap;

    const dualAgree = citationGap >= cfg.minCitationGap && simGrowth >= cfg.minSimGrowth;

    const suppressedFor: string[] = [];
    if (p.coverage[0] < cfg.minCoverage || p.coverage[1] < cfg.minCoverage) {
      suppressedFor.push("coverage_below_threshold");
    }
    if (p.sizes[0] < cfg.minPubs || p.sizes[1] < cfg.minPubs) {
      suppressedFor.push("field_below_min_pubs");
    }
    if (!dualAgree) {
      suppressedFor.push("signals_disagree");
    }

    return {
      pair: pairKey(p.a, p.b),
      score: round4(score),
      citationGap: round4(citationGap),
      simGrowth: round4(simGrowth),
      dualAgree,
      surfaced: suppressedFor.length === 0,
      suppressedFor,
      crossFlow: round4(p.crossFlow),
      kwSim: round4(p.kwSim),
      kwSimPrior: round4(p.kwSimPrior),
    };
  });
}

/** Rank surfaced gaps by score, descending. Audit copy of unsurfaced retained. */
export function rankGaps(scores: GapScore[], topK: number): GapScore[] {
  return [...scores]
    .filter((s) => s.surfaced)
    .sort((x, y) => y.score - x.score)
    .slice(0, topK);
}

/** All pairs over the given field list (deterministic order). */
export function allPairs(fields: readonly string[] = FIELDS): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < fields.length; i++) {
    for (let j = i + 1; j < fields.length; j++) {
      pairs.push([fields[i]!, fields[j]!]);
    }
  }
  return pairs;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}