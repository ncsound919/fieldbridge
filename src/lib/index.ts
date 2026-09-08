export * from "./types";
export { abstractText } from "./abstract";
export { keywordCounts } from "./keywords";
export { cosine } from "./vector";
export { buildFlowMatrix, normalizeFlow } from "./matrix";
export { validate } from "./validate";
export { ENGINE_CONFIG, fnv1a, stableStringify, hashObject, stageHash, type EngineConfig } from "./config";
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
  buildPairSeries,
  closingRank,
  emergingRank,
  relativeGrowth,
  type PairSeries,
  type ClosingGap,
  type EmergingGap,
} from "./trends";