import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  insertFieldPairs,
  insertGapSignals,
  insertRun,
  insertValidationRuns,
  latestRunId,
  openStore,
  type GapRow,
  type PairRow,
  type ValidationRow,
} from "../src/lib/sqlite-store.js";

function memStore(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE run_manifests (id INTEGER PRIMARY KEY AUTOINCREMENT, engine TEXT NOT NULL, config_hash TEXT NOT NULL, snapshot TEXT NOT NULL, works INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE field_pairs (field_a TEXT NOT NULL, field_b TEXT NOT NULL, year INTEGER NOT NULL, flow_ab REAL NOT NULL, flow_ba REAL NOT NULL, per1k_ab REAL NOT NULL, per1k_ba REAL NOT NULL, coverage_a REAL NOT NULL, coverage_b REAL NOT NULL, keyword_overlap REAL, run_id INTEGER, PRIMARY KEY (field_a, field_b, year, run_id));
    CREATE TABLE gap_signals (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, field_a TEXT NOT NULL, field_b TEXT NOT NULL, year INTEGER NOT NULL, gap_score REAL NOT NULL, citation_gap REAL NOT NULL, sim_growth REAL NOT NULL, status TEXT NOT NULL, suppressed_for TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE validation_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, scored_year INTEGER NOT NULL, prior_year INTEGER NOT NULL, horizon_year INTEGER NOT NULL, threshold REAL NOT NULL, top_k INTEGER NOT NULL, hit_rate REAL NOT NULL, base_rate REAL NOT NULL, lift REAL, total_surfaced INTEGER NOT NULL, bridged_count INTEGER NOT NULL, created_at TEXT NOT NULL);
  `);
  return db;
}

describe("sqlite-store", () => {
  it("openStore creates tables and latestRunId is null on empty store", () => {
    const db = openStore(":memory:");
    expect(latestRunId(db)).toBeNull();
    db.close();
  });

  it("insertRun returns an incrementing id and latestRunId tracks it", () => {
    const db = memStore();
    const id1 = insertRun(db, { engine: "fieldbridge@0.1.0", configHash: "abc", snapshot: "s1", works: 10 });
    const id2 = insertRun(db, { engine: "fieldbridge@0.1.0", configHash: "abc", snapshot: "s2", works: 20 });
    expect(id2).toBe(id1 + 1);
    expect(latestRunId(db)).toBe(id2);
    db.close();
  });

  it("persists field pairs and gap signals under a run id", () => {
    const db = memStore();
    const runId = insertRun(db, { engine: "e", configHash: "c", snapshot: "s", works: 1 });
    const pairs: PairRow[] = [
      { fieldA: "A", fieldB: "B", year: 2023, flowAb: 0.1, flowBa: 0.2, per1kAb: 1, per1kBa: 2, coverageA: 0.9, coverageB: 0.9, keywordOverlap: 0.3 },
    ];
    insertFieldPairs(db, runId, pairs);
    const gaps: GapRow[] = [
      { fieldA: "A", fieldB: "B", year: 2023, gapScore: 0.5, citationGap: 0.8, simGrowth: 0.4, status: "surfaced", suppressedFor: [] },
    ];
    insertGapSignals(db, runId, gaps);

    const row = db.prepare("SELECT flow_ab, keyword_overlap FROM field_pairs WHERE run_id = ?").get(runId) as Record<string, number>;
    expect(row.flow_ab).toBeCloseTo(0.1, 6);
    expect(row.keyword_overlap).toBeCloseTo(0.3, 6);

    const g = db.prepare("SELECT status, suppressed_for FROM gap_signals WHERE run_id = ?").get(runId) as Record<string, string>;
    expect(g.status).toBe("surfaced");
    expect(JSON.parse(g.suppressed_for!)).toEqual([]);
    db.close();
  });

  it("insertValidationRuns records the credibility numbers", () => {
    const db = memStore();
    const rows: ValidationRow[] = [
      { scoredYear: 2020, priorYear: 2017, horizonYear: 2023, threshold: 0.01, topK: 20, hitRate: 0.5, baseRate: 0.43, lift: 1.17, totalSurfaced: 20, bridgedCount: 10 },
    ];
    insertValidationRuns(db, rows);
    const r = db.prepare("SELECT hit_rate, lift FROM validation_runs").get() as Record<string, number>;
    expect(r.hit_rate).toBeCloseTo(0.5, 6);
    expect(r.lift).toBeCloseTo(1.17, 6);
    db.close();
  });
});