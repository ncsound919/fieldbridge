/**
 * Provenance contract: every published artifact must carry a config that is
 * EXACTLY the runtime ENGINE_CONFIG. This is the build-time guard the review
 * demanded — a chart, leaderboard entry, or benchmark number can only be
 * reproduced if the config that generated it is the config that runs.
 *
 * If this test fails, the artifacts are stale: regenerate them with
 *   npm run calibrate -- --snapshot python/phase1/phase1_results.json --out public/calibration.json
 *   npm run artifact  -- --snapshot python/phase1/phase1_results.json --out public/fieldbridge-matrix.json --db data/fieldbridge.db
 *   npm run validate -- --snapshot python/phase1/phase1_results.json --out public/validation.json --db data/fieldbridge.db
 *   npm run benchmark -- --snapshot python/phase1/phase1_results.json --out public/benchmark.json
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENGINE_CONFIG, hashObject, SUBFIELD_CONFIG, type EngineConfig } from "../src/lib/index.js";

const ARTIFACTS = [
  "public/calibration.json",
  "public/fieldbridge-matrix.json",
  "public/validation.json",
  "public/benchmark.json",
] as const;

function loadConfigHash(path: string): { configHash: string; config: EngineConfig | undefined } {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as {
    manifest: { configHash: string; config?: EngineConfig };
  };
  if (!parsed.manifest?.configHash) {
    throw new Error(`${path} has no manifest.configHash — run the artifact generator first`);
  }
  return { configHash: parsed.manifest.configHash, config: parsed.manifest.config };
}

describe("config provenance", () => {
  it.each(ARTIFACTS)("%s configHash matches runtime ENGINE_CONFIG", (path) => {
    const { configHash } = loadConfigHash(path);
    expect(configHash).toBe(hashObject(ENGINE_CONFIG));
  });

  it("every artifact embeds the full runtime config object", () => {
    for (const path of ARTIFACTS) {
      const { config } = loadConfigHash(path);
      expect(config, `${path} must embed manifest.config`).toBeDefined();
      expect(config).toEqual(ENGINE_CONFIG);
    }
  });

  it("calibration.json recommended config equals runtime config", () => {
    const raw = JSON.parse(readFileSync("public/calibration.json", "utf8")) as {
      recommended: EngineConfig;
    };
    expect(raw.recommended).toEqual(ENGINE_CONFIG);
  });

  it("subfield-benchmark.json carries the subfield experiment config, not the field config", () => {
    const { configHash, config } = loadConfigHash("public/subfield-benchmark.json");
    expect(configHash).toBe(hashObject(SUBFIELD_CONFIG));
    expect(config).toEqual(SUBFIELD_CONFIG);
    // Guard against config confusion: the subfield hash must differ from the field hash.
    expect(configHash).not.toBe(hashObject(ENGINE_CONFIG));
  });
});