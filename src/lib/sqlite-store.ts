/**
 * Durable SQLite store for pipeline aggregates (run manifests, field pairs,
 * gap signals, validation runs).
 *
 * Rationale: the nightly job is single-operator with no cloud dependency yet —
 * SQLite is zero-ops, ACID, and ships with Node/Python. The schema mirrors
 * supabase/schema.sql so moving to Postgres later is a migration, not a
 * rewrite. The static JSON artifact remains the dashboard feed; this store is
 * the queryable history (multi-night trends, retrospective validation).
 */

import { DatabaseSync } from "node:sqlite";

export interface StoreManifest {
  engine: string;
  configHash: string;
  snapshot: string;
  works: number;
}

export interface PairRow {
  fieldA: string;
  fieldB: string;
  year: number;
  flowAb: number;
  flowBa: number;
  per1kAb: number;
  per1kBa: number;
  coverageA: number;
  coverageB: number;
  keywordOverlap: number | null;
}

export interface GapRow {
  fieldA: string;
  fieldB: string;
  year: number;
  gapScore: number;
  citationGap: number;
  simGrowth: number;
  status: "surfaced" | "suppressed";
  suppressedFor: string[];
}

export interface ValidationRow {
  scoredYear: number;
  priorYear: number;
  horizonYear: number;
  threshold: number;
  topK: number;
  hitRate: number;
  baseRate: number;
  lift: number | null;
  totalSurfaced: number;
  bridgedCount: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS run_manifests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  engine TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  works INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS field_pairs (
  field_a TEXT NOT NULL,
  field_b TEXT NOT NULL,
  year INTEGER NOT NULL,
  flow_ab REAL NOT NULL,
  flow_ba REAL NOT NULL,
  per1k_ab REAL NOT NULL,
  per1k_ba REAL NOT NULL,
  coverage_a REAL NOT NULL,
  coverage_b REAL NOT NULL,
  keyword_overlap REAL,
  run_id INTEGER REFERENCES run_manifests(id),
  PRIMARY KEY (field_a, field_b, year, run_id)
);
CREATE TABLE IF NOT EXISTS gap_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER REFERENCES run_manifests(id),
  field_a TEXT NOT NULL,
  field_b TEXT NOT NULL,
  year INTEGER NOT NULL,
  gap_score REAL NOT NULL,
  citation_gap REAL NOT NULL,
  sim_growth REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('surfaced','suppressed')),
  suppressed_for TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS validation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scored_year INTEGER NOT NULL,
  prior_year INTEGER NOT NULL,
  horizon_year INTEGER NOT NULL,
  threshold REAL NOT NULL,
  top_k INTEGER NOT NULL,
  hit_rate REAL NOT NULL,
  base_rate REAL NOT NULL,
  lift REAL,
  total_surfaced INTEGER NOT NULL,
  bridged_count INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS field_pairs_year_idx ON field_pairs (year);
CREATE INDEX IF NOT EXISTS gap_signals_year_idx ON gap_signals (year, status);
`;

export function openStore(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

/** Insert a run manifest and return its rowid. */
export function insertRun(db: DatabaseSync, manifest: StoreManifest): number {
  const res = db
    .prepare(
      `INSERT INTO run_manifests (engine, config_hash, snapshot, works, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(manifest.engine, manifest.configHash, manifest.snapshot, manifest.works, new Date().toISOString());
  return Number(res.lastInsertRowid);
}

export function insertFieldPairs(db: DatabaseSync, runId: number, rows: PairRow[]): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO field_pairs
       (field_a, field_b, year, flow_ab, flow_ba, per1k_ab, per1k_ba,
        coverage_a, coverage_b, keyword_overlap, run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    stmt.run(r.fieldA, r.fieldB, r.year, r.flowAb, r.flowBa, r.per1kAb, r.per1kBa,
      r.coverageA, r.coverageB, r.keywordOverlap, runId);
  }
}

export function insertGapSignals(db: DatabaseSync, runId: number, rows: GapRow[]): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO gap_signals
       (run_id, field_a, field_b, year, gap_score, citation_gap, sim_growth, status, suppressed_for)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    stmt.run(runId, r.fieldA, r.fieldB, r.year, r.gapScore, r.citationGap, r.simGrowth,
      r.status, JSON.stringify(r.suppressedFor));
  }
}

export function insertValidationRuns(db: DatabaseSync, rows: ValidationRow[]): void {
  const stmt = db.prepare(
    `INSERT INTO validation_runs
       (scored_year, prior_year, horizon_year, threshold, top_k, hit_rate, base_rate, lift,
        total_surfaced, bridged_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    stmt.run(r.scoredYear, r.priorYear, r.horizonYear, r.threshold, r.topK, r.hitRate,
      r.baseRate, r.lift, r.totalSurfaced, r.bridgedCount, new Date().toISOString());
  }
}

/** Latest run id (most recent manifest). */
export function latestRunId(db: DatabaseSync): number | null {
  const row = db.prepare("SELECT MAX(id) AS id FROM run_manifests").get() as { id: number | null } | undefined;
  return row?.id ?? null;
}