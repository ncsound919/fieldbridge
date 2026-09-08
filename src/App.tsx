import { useEffect, useMemo, useState } from "react";

interface Manifest {
  engine: string;
  configHash: string;
  snapshot: string;
  works: number;
  generatedAt: string;
}

interface FlowRow {
  [cited: string]: number;
  _total_refs: number;
  _total_refs_resolved: number;
}

interface GapScore {
  pair: string;
  score: number;
  citationGap: number;
  simGrowth: number;
  dualAgree: boolean;
  surfaced: boolean;
  suppressedFor: string[];
  crossFlow: number;
  kwSim: number;
  kwSimPrior: number;
  coverage: [number, number];
  sizes: [number, number];
}

interface ClosingGap {
  pair: string;
  a: string;
  b: string;
  closingRate: number;
  kwSimGrowth: number;
  crossFlowCurrent: number;
  kwSimCurrent: number;
}

interface EmergingGap {
  pair: string;
  a: string;
  b: string;
  kwSimGrowth: number;
  crossFlowCurrent: number;
  emergenceScore: number;
}

interface TrendSeries {
  pair: string;
  crossFlow: number[];
  kwSim: number[];
}

interface ValidationWindow {
  current: number;
  prior: number;
  horizon: number;
  threshold: number;
  surfaced: number;
  bridged: number;
  hitRate: number;
  baseRate: number;
  lift: number | null;
  precisionAtK: number[];
}

interface ValidationData {
  manifest: Manifest;
  years: number[];
  windows: ValidationWindow[];
}

interface BenchmarkCI {
  lower: number;
  upper: number;
  mean: number;
  median: number;
}

interface BenchmarkBaseline {
  name: string;
  hitRate: number;
  baseRate: number;
  lift: number | null;
}

interface BenchmarkWindowResult {
  current: number;
  prior: number;
  horizon: number;
  heldOut: boolean;
  calibrationWindow: boolean;
  hitRate: number;
  baseRate: number;
  lift: number | null;
  liftCI: BenchmarkCI | null;
  baselines: BenchmarkBaseline[];
}

interface BenchmarkData {
  manifest: Manifest;
  primary: {
    windows: BenchmarkWindowResult[];
    pooled: BenchmarkBaseline | null;
    verdict: { passed: boolean; state: string; reason: string };
    successThreshold: { lowerCILift: number; consecutiveWindows: number };
  };
}

interface Artifact {
  manifest: Manifest;
  fields: string[];
  years: number[];
  flows: Record<string, Record<string, FlowRow>>;
  per1k: Record<string, Record<string, number>>;
  coverage: Record<string, number>;
  sizes: Record<string, number>;
  keywordOverlap: Record<string, number>;
  gaps: { surfaced: GapScore[]; suppressed: GapScore[]; signalCount: number };
  trends: { closing: ClosingGap[]; emerging: EmergingGap[]; series: TrendSeries[] };
  drilldown: Record<string, { sharedKeywords: string[]; bridgePapers: number }>;
}

const LOW_COVERAGE = 0.5;

export function App() {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [validation, setValidation] = useState<ValidationData | null>(null);
  const [benchmark, setBenchmark] = useState<BenchmarkData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<[string, string] | null>(null);
  const [showSuppressed, setShowSuppressed] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("fieldbridge-matrix.json").then((r) => {
        if (!r.ok) throw new Error(`matrix HTTP ${r.status}`);
        return r.json();
      }),
      fetch("validation.json")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("benchmark.json")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([a, v, b]) => {
        setArtifact(a);
        setValidation(v);
        setBenchmark(b);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  if (error) {
    return (
      <div className="panel error">
        Could not load fieldbridge-matrix.json — {error}. Run{" "}
        <code>npm run artifact -- --snapshot python/phase1/phase1_results.json</code> first.
      </div>
    );
  }
  if (!artifact) return <div className="panel">Loading…</div>;

  const { fields, flows, per1k, coverage, sizes, gaps, keywordOverlap, manifest, years, trends, drilldown } = artifact;
  const current = String(artifact.years[artifact.years.length - 1]);
  const matrix = flows[current] ?? {};

  return (
    <div className="shell">
      <header>
        <h1>FieldBridge</h1>
        <p className="subtitle">
          Where disciplines connect, where they don't, and which gaps are closing — computed
          deterministically from OpenAlex data.
        </p>
      </header>

      <section className="panel">
        <h2>Coverage check <span className="muted">(resolved refs / declared refs)</span></h2>
        <p className="muted note">
          Pairs under {Math.round(LOW_COVERAGE * 100)}% coverage are suppressed from gap scoring —
          a coverage artifact must never be reported as a gap.
        </p>
        <div className="chips">
          {fields.map((f) => {
            const cov = coverage[f] ?? 0;
            return (
              <span key={f} className={`chip ${cov < LOW_COVERAGE ? "chip-bad" : cov < 0.8 ? "chip-warn" : ""}`}
                title={`${f}: ${(cov * 100).toFixed(0)}% coverage, ${sizes[f]} pubs`}>
                {f}
                <b>{(cov * 100).toFixed(0)}%</b>
              </span>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h2>Citation flow matrix <span className="muted">({current}, share of resolved refs)</span></h2>
        <Heatmap fields={fields} matrix={matrix} onSelect={setSelected} />
        {selected && <PairDetail pair={selected} matrix={matrix} per1k={per1k} overlap={keywordOverlap} gaps={gaps} series={trends.series} years={years} drilldown={drilldown[pairKey(selected[0], selected[1])]} />}
      </section>

      <section className="panel">
        <h2>Trends — which gaps are closing, which are emerging <span className="muted">(cross-flow series across {years.join(" → ")})</span></h2>
        <p className="muted note">
          Closing = a baseline-surfaced gap whose citation cross-flow is growing fastest.
          Emerging = keyword convergence while cross-flow stays sparse.
          Both are pure functions of the per-year series; no wall-clock dependence.
        </p>
        <div className="trend-cols">
          <div>
            <h3>Fastest-closing gaps</h3>
            <ul className="gaps">
              {trends.closing.length === 0 && <li className="muted">none (no baseline-surfaced gaps closing)</li>}
              {trends.closing.map((c) => (
                <li key={c.pair}>
                  <span className="gap-pair">{c.pair}</span>
                  <span className="gap-score">closing ×{c.closingRate.toFixed(1)}</span>
                  <span className="gap-metric">cross-flow {c.crossFlowCurrent.toFixed(4)}</span>
                  <SeriesBars values={seriesOf(trends.series, c.pair)?.crossFlow ?? []} />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Emerging connections</h3>
            <ul className="gaps">
              {trends.emerging.length === 0 && <li className="muted">none</li>}
              {trends.emerging.map((e) => (
                <li key={e.pair}>
                  <span className="gap-pair">{e.pair}</span>
                  <span className="gap-score">emergence {e.emergenceScore.toFixed(3)}</span>
                  <span className="gap-metric">kwSim growth {e.kwSimGrowth.toFixed(1)}×</span>
                  <SeriesBars values={seriesOf(trends.series, e.pair)?.kwSim ?? []} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Gap leaderboard <span className="muted">(dual-signal: sparse citation flow × converging keywords)</span></h2>
        <p className="muted note">
          {gaps.signalCount} pairs scored. Only {gaps.surfaced.length} cleared both signal thresholds and
          the coverage/size guards.
        </p>
        <GapList gaps={gaps.surfaced} />
        <button className="toggle" onClick={() => setShowSuppressed((v) => !v)}>
          {showSuppressed ? "Hide" : "Show"} suppressed pairs ({gaps.suppressed.length})
        </button>
        {showSuppressed && <GapList gaps={gaps.suppressed} suppressed />}
      </section>

      {validation && <ValidationPanel validation={validation} />}
      {benchmark && <BenchmarkPanel benchmark={benchmark} />}

      <footer className="panel manifest">
        <h2>Run manifest</h2>
        <table>
          <tbody>
            <tr><td>engine</td><td>{manifest.engine}</td></tr>
            <tr><td>config hash</td><td><code>{manifest.configHash}</code></td></tr>
            <tr><td>snapshot</td><td><code>{manifest.snapshot}</code></td></tr>
            <tr><td>works</td><td>{manifest.works.toLocaleString()}</td></tr>
            <tr><td>generated</td><td>{new Date(manifest.generatedAt).toISOString()}</td></tr>
          </tbody>
        </table>
      </footer>
    </div>
  );
}

function Heatmap({
  fields,
  matrix,
  onSelect,
}: {
  fields: string[];
  matrix: Record<string, FlowRow>;
  onSelect: (p: [string, string]) => void;
}) {
  const max = useMemo(() => {
    let m = 0;
    for (const f of fields) for (const g of fields) m = Math.max(m, matrix[f]?.[g] ?? 0);
    return m || 1;
  }, [fields, matrix]);

  return (
    <div className="heatmap" style={{ gridTemplateColumns: `160px repeat(${fields.length}, 1fr)` }}>
      <div />
      {fields.map((g) => (
        <div key={g} className="col-head" title={g}>
          {short(g)}
        </div>
      ))}
      {fields.map((f) => (
        <div key={f} className="row">
          <div className="row-head" title={f}>{short(f)}</div>
          {fields.map((g) => {
            const v = matrix[f]?.[g] ?? 0;
            const self = f === g;
            const key = `${f}\u0000${g}`;
            return (
              <button
                key={key}
                className={`cell ${self ? "cell-self" : ""}`}
                style={self ? undefined : { backgroundColor: heatColor(v / max) }}
                onClick={() => onSelect([f, g])}
                title={`${f} cites into ${g}: ${(v * 100).toFixed(2)}%`}
              >
                {self ? "" : (v * 100).toFixed(1)}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function PairDetail({
  pair,
  matrix,
  per1k,
  overlap,
  gaps,
  series,
  years,
  drilldown,
}: {
  pair: [string, string];
  matrix: Record<string, FlowRow>;
  per1k: Record<string, Record<string, number>>;
  overlap: Record<string, number>;
  gaps: Artifact["gaps"];
  series: TrendSeries[];
  years: number[];
  drilldown: { sharedKeywords: string[]; bridgePapers: number } | undefined;
}) {
  const [a, b] = pair;
  const key = pairKey(a, b);
  const scored = [...gaps.surfaced, ...gaps.suppressed].find((g) => g.pair === key);
  const s = seriesOf(series, key);
  return (
    <div className="pair-detail">
      <h3>
        {a} × {b}
      </h3>
      <table>
        <tbody>
          <tr><td>{a} → {b} citations</td><td>{((matrix[a]?.[b] ?? 0) * 100).toFixed(2)}%</td></tr>
          <tr><td>{b} → {a} citations</td><td>{(matrix[b]?.[a] ?? 0).toFixed(2)}%</td></tr>
          <tr><td>{a} → {b} per 1k papers</td><td>{(per1k[a]?.[b] ?? 0).toFixed(1)}</td></tr>
          <tr><td>{b} → {a} per 1k papers</td><td>{(per1k[b]?.[a] ?? 0).toFixed(1)}</td></tr>
          <tr><td>keyword overlap</td><td>{(overlap[key] ?? 0).toFixed(3)}</td></tr>
          {scored && (
            <>
              <tr><td>gap score</td><td>{scored.score}</td></tr>
              <tr><td>citation gap</td><td>{scored.citationGap}</td></tr>
              <tr><td>sim growth</td><td>{scored.simGrowth}</td></tr>
              <tr>
                <td>status</td>
                <td className={scored.surfaced ? "ok" : "warn"}>
                  {scored.surfaced ? "SURFACED" : scored.suppressedFor.join(", ")}
                </td>
              </tr>
            </>
          )}
          {s && (
            <tr>
              <td>cross-flow series</td>
              <td>
                <SeriesBars values={s.crossFlow} />
                <span className="muted"> ({years.join(" → ")})</span>
              </td>
            </tr>
          )}
          {drilldown && (
            <>
              <tr>
                <td>shared keywords</td>
                <td className="kw-chips">
                  {drilldown.sharedKeywords.slice(0, 8).map((k) => (
                    <span key={k} className="kw-chip">{k}</span>
                  ))}
                </td>
              </tr>
              <tr>
                <td>bridge papers (in sample)</td>
                <td>{drilldown.bridgePapers}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

function GapList({ gaps, suppressed = false }: { gaps: GapScore[]; suppressed?: boolean }) {
  if (gaps.length === 0) return <p className="muted">No {suppressed ? "suppressed" : "surfaced"} pairs.</p>;
  return (
    <ul className="gaps">
      {gaps.map((g) => (
        <li key={g.pair} className={suppressed ? "gap-suppressed" : ""}>
          <span className="gap-pair">{g.pair}</span>
          <span className="gap-score">score {g.score}</span>
          <span className="gap-metric">cite-gap {g.citationGap}</span>
          <span className="gap-metric">sim-growth {g.simGrowth}</span>
          {suppressed && <span className="gap-reason">{g.suppressedFor.join(", ")}</span>}
        </li>
      ))}
    </ul>
  );
}

function ValidationPanel({ validation }: { validation: ValidationData }) {
  return (
    <section className="panel">
      <h2>Retrospective validation <span className="muted">(of the gaps this engine surfaced, how many actually bridged?)</span></h2>
      <p className="muted note">
        Gaps surfaced at <code>{validation.windows[0]?.current}</code> (scored against the prior
        year) are checked against cross-flow at the horizon. <b>Hit-rate vs base-rate (random
        selection) is reported — a gap score that doesn't beat random is a finding, not a
        credential.</b> Thresholds are swept, not cherry-picked.
      </p>
      <table className="validation-table">
        <thead>
          <tr>
            <th>scored@</th>
            <th>horizon</th>
            <th>threshold</th>
            <th>hit-rate</th>
            <th>base-rate</th>
            <th>lift</th>
            <th>bridged</th>
          </tr>
        </thead>
        <tbody>
          {validation.windows.map((w, i) => {
            const beats = w.lift !== null && w.lift >= 1;
            return (
              <tr key={i} className={beats ? "row-good" : ""}>
                <td>{w.current}</td>
                <td>{w.horizon}</td>
                <td>{(w.threshold * 100).toFixed(1)}%</td>
                <td className={beats ? "ok" : "warn"}>{w.hitRate.toFixed(2)}</td>
                <td>{w.baseRate.toFixed(2)}</td>
                <td>{w.lift === null ? "—" : `${w.lift.toFixed(2)}×`}</td>
                <td>{w.bridged}/{w.surfaced}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted note">
        Caveat: "bridged" is defined on this snapshot's own horizon-year data (self-consistency).
        External validation (did new cross-field papers actually publish and cite across the pair)
        accrues as the nightly job accumulates fresh snapshots.
      </p>
    </section>
  );
}

function BenchmarkPanel({ benchmark }: { benchmark: BenchmarkData }) {
  const { primary } = benchmark;
  const verdictClass = primary.verdict.state === "PASS" ? "ok" : primary.verdict.state === "PENDING" ? "" : "warn";
  return (
    <section className="panel">
      <h2>
        Prediction benchmark{" "}
        <span className="muted">(rolling-origin, held-out windows, explicit baselines)</span>
      </h2>
      <p className="muted note">
        The engine is only allowed the word <b>"predictive"</b> after it beats simple baselines on
        time windows it was never fitted on. Pre-registered success threshold: lower 95% CI of lift{" "}
        &gt; {primary.successThreshold.lowerCILift} on {primary.successThreshold.consecutiveWindows}{" "}
        consecutive held-out windows.
      </p>
      <div className={`verdict ${verdictClass}`}>
        <b>Verdict: {primary.verdict.state}</b> — {primary.verdict.reason}
      </div>
      {primary.pooled && (
        <p className="muted note">
          Pooled held-out lift: {primary.pooled.lift === null ? "—" : `${primary.pooled.lift.toFixed(2)}×`}{" "}
          (hit {primary.pooled.hitRate.toFixed(2)} vs base {primary.pooled.baseRate.toFixed(2)}).
        </p>
      )}
      {primary.windows.map((w, i) => {
        const tag = w.heldOut ? "held-out" : w.calibrationWindow ? "calibration window" : "nowcast";
        return (
          <div key={i} className="benchmark-window">
            <h3>
              scored@{w.current} → {w.horizon}{" "}
              <span className={`muted tag ${w.heldOut ? "ok" : ""}`}>{tag}</span>{" "}
              <span className="muted">
                lift {w.lift === null ? "—" : `${w.lift.toFixed(2)}×`} (95% CI{" "}
                {w.liftCI ? `${w.liftCI.lower.toFixed(2)}..${w.liftCI.upper.toFixed(2)}` : "—"})
              </span>
            </h3>
            <table className="validation-table">
              <thead>
                <tr>
                  <th>baseline</th>
                  <th>hit-rate</th>
                  <th>base-rate</th>
                  <th>lift</th>
                </tr>
              </thead>
              <tbody>
                {w.baselines.map((bl, j) => {
                  const beats = bl.lift !== null && bl.lift >= 1;
                  const isFull = bl.name === "full";
                  return (
                    <tr key={j} className={isFull ? "row-good" : ""}>
                      <td>
                        {bl.name}
                        {isFull ? " (engine)" : ""}
                      </td>
                      <td className={beats ? "ok" : "warn"}>{bl.hitRate.toFixed(2)}</td>
                      <td>{bl.baseRate.toFixed(2)}</td>
                      <td>{bl.lift === null ? "—" : `${bl.lift.toFixed(2)}×`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      <p className="muted note">
        The engine's score must beat <b>highest-simgrowth</b> and <b>highest-crossflow-growth</b> to
        justify its formula. If it ties or loses to them (or to random), the formula is descriptive,
        not predictive — that is a finding, not a defect.
      </p>
    </section>
  );
}

function short(name: string): string {
  const words = name.split(" ");
  if (words.length === 1) return name.slice(0, 14);
  // "Agricultural and Biological Sciences" -> "Agricultural…"
  return name.length > 16 ? name.slice(0, 15) + "…" : name;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join(" \u00d7 ");
}

function seriesOf(series: TrendSeries[], key: string): TrendSeries | undefined {
  return series.find((s) => s.pair === key);
}

/** Minimal inline bar sparkline — no chart library, free-tier honest. */
function SeriesBars({ values }: { values: number[] }) {
  const max = Math.max(...values, 0.0001);
  return (
    <span className="bars" title={values.map((v) => v.toFixed(4)).join(", ")}>
      {values.map((v, i) => (
        <span
          key={i}
          className="bar"
          style={{ height: `${Math.max(6, (v / max) * 18)}px` }}
        />
      ))}
    </span>
  );
}

function heatColor(t: number): string {
  // low flow -> near-white, high flow -> saturated blue.
  const s = Math.min(1, Math.sqrt(Math.max(0, t)));
  return `rgba(13, 71, 161, ${(s * 0.9).toFixed(3)})`;
}