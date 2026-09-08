/**
 * FieldBridge snapshot → matrix CLI.
 *
 * Reads the raw snapshot written by python/phase0/run.py and produces the
 * citation-flow matrix + all three validation checks using the unit-tested
 * TS library. Works and abstracts are stored in the snapshot, so V3 (keyword
 * overlap) is derived here for real.
 *
 * Usage:
 *   npm run matrix -- --snapshot phase0_results.json
 */
import { readFileSync } from "node:fs";
import {
  abstractText,
  buildFlowMatrix,
  cosine,
  ENGINE_CONFIG,
  hashObject,
  keywordCounts,
  normalizeFlow,
  validate,
  type FieldName,
  type Work,
} from "./lib/index.js";

interface Snapshot {
  meta: { fields: string[] };
  works: Record<string, Work[]>;
  cited_fields: Record<string, string | null>;
}

const args = process.argv.slice(2);
const snapshotArg = args.find((a, i) => args[i - 1] === "--snapshot") ?? args[0];

if (!snapshotArg) {
  console.error("usage: npm run matrix -- --snapshot <phase0_results.json>");
  process.exit(1);
}

const snapshot: Snapshot = JSON.parse(readFileSync(snapshotArg, "utf8"));
const fields = snapshot.meta.fields as FieldName[];
// The snapshot is our own writer's output; treat it as the trusted boundary.
// Non-field display names ("Unknown") flow through and are excluded by
// buildFlowMatrix exactly as in the Python pipeline.
const cache = new Map(Object.entries(snapshot.cited_fields)) as Map<FieldName, FieldName | null>;

const flows = buildFlowMatrix(snapshot.works, cache);
const sizes = {} as Record<FieldName, number>;
for (const f of fields) sizes[f] = (snapshot.works[f] ?? []).length;
const norm = normalizeFlow(flows, sizes);
const kws = {} as Record<FieldName, Record<string, number>>;
for (const f of fields) {
  kws[f] = keywordCounts((snapshot.works[f] ?? []).map((w) => abstractText(w.abstract_inverted_index)));
}

console.log("=== CITATION FLOW MATRIX (row = citing field, values = share of resolved refs) ===");
const header = "cites into ->   " + fields.map((f) => f.slice(0, 12).padStart(14)).join("");
console.log(header);
for (const f of fields) {
  let row = f.slice(0, 14).padEnd(16);
  for (const g of fields) row += (flows[f]?.[g] ?? 0).toFixed(4).padStart(14);
  console.log(row);
  console.log(
    "".padEnd(16) +
      `resolved refs: ${flows[f]?._total_refs_resolved}/${flows[f]?._total_refs} ` +
      `(coverage ${((norm.coverage[f] ?? 0) * 100).toFixed(0)}%)  pubs: ${sizes[f]}`,
  );
}

console.log("\n=== SIZE-NORMALIZED CROSS-FLOW (citations per 1000 papers, citing field) ===");
const normHeader = "cites into ->   " + fields.map((f) => f.slice(0, 12).padStart(14)).join("");
console.log(normHeader);
for (const f of fields) {
  let row = f.slice(0, 14).padEnd(16);
  for (const g of fields) row += (norm.per1k[f]?.[g] ?? 0).toFixed(2).padStart(14);
  console.log(row);
}

console.log("\n=== KEYWORD OVERLAP (cosine, top-200 tokens) ===");
for (let i = 0; i < fields.length; i++) {
  for (let j = i + 1; j < fields.length; j++) {
    const a = fields[i]!;
    const b = fields[j]!;
    console.log(`  ${a.padEnd(13)} x ${b.padEnd(13)} = ${cosine(kws[a]!, kws[b]!).toFixed(4)}`);
  }
}

console.log("\n=== VALIDATION CHECKS ===");
let passed = 0;
const checks = validate(flows, kws);
for (const { label, ok, detail } of checks) {
  passed += ok ? 1 : 0;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}`);
  console.log(`         ${JSON.stringify(detail)}`);
}
console.log(`\n${passed}/${checks.length} checks passed. Sampling noise can flip borderline checks — re-run with --sample 1000 to confirm.`);

console.log("\n=== RUN MANIFEST (provenance) ===");
console.log(`  engine:    fieldbridge@${ENGINE_CONFIG.version}`);
console.log(`  config:    ${hashObject(ENGINE_CONFIG)} (hash of ENGINE_CONFIG)`);
console.log(`  snapshot:  ${snapshotArg} (${Object.values(snapshot.works).reduce((n, w) => n + w.length, 0)} works)`);
console.log("  note:      low-coverage pairs are suppressed by gap scoring, not reported as gaps.");