export * from "./types";
export { abstractText } from "./abstract";
export { keywordCounts } from "./keywords";
export { cosine } from "./vector";
export { buildFlowMatrix, normalizeFlow, trackedFlowShare } from "./matrix";
export { validate } from "./validate";
export { ENGINE_CONFIG, fnv1a, stableStringify, hashObject, stageHash, type EngineConfig } from "./config";
export {
  referenceShares,
  disparityMatrix,
  gini,
  raoStirling,
  shannon,
  simpson,
  diversityOf,
  bootstrapRaoStirling,
  diversityDelta,
  type DiversityProfile,
} from "./diversity";
export {
  scorePairs,
  rankGaps,
  allPairs,
  normSimGrowth,
  crossFlowOf,
  type GapScore,
  type PairSignals,
} from "./gaps";
export { retrospectiveValidate, type HistoricalRun, type ValidationResult } from "./validation";
export {
  SUBFIELD_CONFIG,
  rollingOriginBenchmark,
  baselineRankings,
  pairBootstrapLift,
  buildBenchmarkPairs,
  benchmarkWindow,
  type BenchmarkWindow,
  type BenchmarkResult,
  type BenchmarkPair,
  type BaselineResult,
  type ConfidenceInterval,
} from "./benchmark";
export {
  buildPairSeries,
  closingRank,
  emergingRank,
  convergingRank,
  convergenceTest,
  relativeGrowth,
  type PairSeries,
  type ClosingGap,
  type EmergingGap,
  type ConvergingPair,
  type DirectionalGrowth,
  type ConvergenceCounts,
} from "./trends";