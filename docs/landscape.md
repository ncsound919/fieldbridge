# FieldBridge — Competitive Landscape & Positioning (Sep 2026)

Decision document. Sources are linked; claims are labeled fact / inference /
recommendation. Research method: web search over current (2025–2026) tooling,
comparisons, vendor pages, and funding announcements.

## 1. Executive summary

FieldBridge's headline wedge — **"ranked list of where science is about to
connect" (gap detection between disciplines)** — is *not* unclaimed:

- The **enterprise incumbents** (Clarivate, Elsevier SciVal) already ship
  "emerging topics / research fronts" detection — on closed, curated data, to
  institutions, at institution prices.
- A **new wave of AI "research gap" tools** (Questinno Question Miner, Fynman,
  PaperGuide, Accept Ideas, FrontierPath) is selling the same promise to
  individual researchers, mostly with LLM-flavored (non-reproducible) methods.
- An **open preprint (LitGapFinder, 2026)** publishes essentially the same gap
  formula FieldBridge proposes: `semantic_similarity × (1 − co-occurrence)`.

What is *not* claimed anywhere we found:

- A **live, self-updating discipline×discipline citation matrix** as a product
  anyone can open in a browser. SciVal's "Wheel of Science" is closest, but
  closed-data, institution-only, and a small bubble view — not an explorable
  matrix.
- **Reproducible, deterministic, versioned gap detection** with provenance
  (the LLM gap-tools can't show their work; FieldBridge's engine is designed
  to). Trust is a real wedge in a category where the failure mode is
  hallucinated "gaps."

The honest strategic question is **who pays**, and the honest risk is
**data-coverage bias destroying the product's core signal** (see §6).

## 2. The four landscape layers

### Layer A — Desktop bibliometric tools (free, researcher-run)
VOSviewer, CiteSpace, Bibliometrix/Biblioshiny, biblioMagika, Sci2, Pajek,
Gephi, CitNetExplorer.

- All **free**. All require the user to **bring their own data** (WoS/Scopus
  exports). All desktop/Java or R. No live data, no hosted UI, no account.
- CiteSpace already ships **Kleinberg citation-burst detection** — "burst
  detection" is therefore *not* a differentiator.
- Verdict: they compete on *depth of analysis of a known field*. FieldBridge
  competes on the *space between fields*. Complementary, not a substitute.

### Layer B — Web literature-discovery tools (consumer researchers)
Connected Papers ($3/mo, 5 free graphs), ResearchRabbit (free), Litmaps
($10/mo, monitoring + alerts), Inciteful (free, Literature Connector),
Open Knowledge Maps (free), scite ($12/mo), Ponder ($14/mo), Elicit.

- All **paper-centric**: seed paper → related graph. None is
  discipline-centric. None does cross-field gap scoring.
- Category is **price-sensitive**: free tiers dominate; best paid plans are
  $3–14/mo. Consumer willingness-to-pay here is weak.
- Closest behavioral competitor is **Litmaps** (ongoing monitoring + alerts) —
  the "keep me current on this field" loop FieldBridge wants for *gaps*.

### Layer C — Institutional research intelligence (enterprise, closed data)
- **Elsevier SciVal Topics** — ~94k topics, Topic Clusters, **Prominence
  percentile** (momentum), "newly emerged Topics" (growth + citations +
  funding acknowledgements). Closed Scopus data, institution-priced.
- **Clarivate** — ESI Research Fronts (co-citation clusters, hot/emerging,
  ~13.8k fronts) and the **May 2026 launch of Web of Science Research
  Intelligence**: an AI-native platform for funding/strategy/impact aimed
  squarely at research offices. This is the incumbent's answer to "AI research
  strategy."
- Verdict: the incumbents *do* frontier/gap detection, but on curated paywalled
  data for institutions. Their strengths (coverage, trust) are their weakness
  (price, opacity, no self-serve explorer).

### Layer D — New AI "gap" entrants (consumer + preprint)
- **Questinno Question Miner** — extracts citation-context signals (limitations,
  contradictions) from a paper title, ranks opportunities. LLM-assisted.
- **Fynman Research Gap Analysis** — AI scans fields, ranks gaps by
  impact/feasibility/funding-probability. Claims 500+ publications, 200+
  funded grants from its gaps.
- **PaperGuide Research Gap Finder** — evidence-coverage mapping + active
  falsification attempts; graded gap reports.
- **Accept Ideas** — daily analysis of 800+ papers, venue-tier predictions.
- **FrontierPath** — frontier mapping powered by Claude on Bedrock.
- **LitGapFinder** (clawRxiv 2603.00235, open) — arXiv+S2 retrieval, concept
  co-occurrence graph, MiniLM embeddings, gap score =
  `sim × 1/(1+co_occurrence)`, validated at **60% hit-rate@10** against papers
  published after cutoff. This is the closest published analogue to
  FieldBridge's `norm(sim_growth) × (1 − norm(citation_density))`.
- Verdict: the "AI gap finder" category exists and is crowded in messaging.
  None of them is reproducible or shows a citation-flow matrix. LitGapFinder
  proves the *formula* is implementable openly — FieldBridge's moat cannot be
  the formula alone; it must be execution + trust + live matrix.

## 3. The actual whitespace (fact-based)

1. **No live, explorable discipline×discipline matrix exists as a web
   product.** Every tool is paper-centric or institution-walled.
2. **No gap tool is reproducible.** The determinism/provenance engine
   (trend-engine-architecture.md) is genuinely differentiated against both the
   LLM entrants (opaque) and the incumbents (closed).
3. **OpenAlex makes the full 19-field / 26-domain matrix computable on a free
   budget** — the one data source that is CC0, free-API, and full-scale.
   Incumbents are locked to paywalled data; FieldBridge's *entire* matrix can
   be public, exported, and re-verified by anyone.

## 4. Who pays (market reality)

- **Individual researchers / PhDs**: price-sensitive; free tiers dominate; best
  paid plans $3–14/mo. Large TAM, low ARPU, hard to reach (SEO + academic
  word-of-mouth). Grants/funders value gap-evidence → could subsidize.
- **Institutions (research offices, libraries, deans)**: real budget (SciVal,
  ESI, Research Intelligence are institution-priced), but they already buy
  Clarivate/Elsevier and expect curated-coverage guarantees.
- **Corporate R&D / innovation units**: pay for tech-landscape intelligence;
  this is where "X methods applied to Y problems" gaps have business value.
- **Funding climate**: consumer bibliometrics is *not* a hot VC category.
  Recent relevant rounds: Signals $1.1M seed (research integrity, ACS/Enago
  strategic) — small; the large 2025–26 rounds (Edison $70M, Mirendil $200M,
  Network Bio $50M) are **AI-scientist / lab-automation**, a different market.
  Research (Fosfuri & Nagar, Research Policy 2026) shows science-heavy startups
  raise later, smaller, at lower valuations.
- **Inference → recommendation**: "fundable" for a bootstrap/angel/strategic
  shape means an *institutional or R&D revenue path*, not a consumer freemium
  subscription alone. A consumer tool is a distribution vehicle / proof, not
  the funding story.

## 5. Positioning options

| Option | Wedge | Buyer | Funding story | Verdict |
|---|---|---|---|---|
| A. Consumer "gap leaderboard" | Live matrix + ranked gaps | PhDs, grant writers | Weak (free-tier category) | Good for reach, not funding |
| B. Institutional "transparent SciVal" | Same frontier detection on open data, reproducible, at 1/10 price | Research offices, libraries | Strategic, real ARPU | Strongest revenue path, hardest sales |
| C. R&D tech-scouting | "Method X → problem Y" gap signals for corporate R&D | Corporate innovation units | Real budgets, faster deals | Strong ARPU, needs vertical focus |
| D. Reproducible science-of-science engine + public evidence | The dataset + validation as a research/credibility asset | Funders, researchers | Grant/strategic (open-tool play) | The "seed credibility" play |

Recommendation: **A as the public front door (reach + proof), B/C as the
revenue spine.** The matrix product is the demo; the institutional/R&D
analytics is the money. This matches how the category actually monetizes.

## 6. Honest risks (must be designed against, not ignored)

1. **Coverage bias is the core signal's poison.** The very pairs FieldBridge
   sells (e.g., Math↔Philosophy "gap") are the ones most distorted by OpenAlex's
   thinner humanities/social-science coverage. A "gap" that is really a
   coverage artifact destroys credibility with exactly the buyers (institutions)
   who care. **Mitigation (non-negotiable):** normalize all flow/similarity
   metrics per-field by coverage share, and publish a per-pair coverage caveat
   before any gap is surfaced. This is a research design problem, not a UI one.
2. **Field-size bias.** Math is small; raw citation flows mislead. Normalize
   per-1k-papers (already in the build plan) — and validate against the
   known-good pairs (Bio↔Chem strong, Math↔Humanities weak).
3. **Formula not a moat.** LitGapFinder publishes the same gap idea openly.
   Moat = live data + provenance + validation history, not the formula.
4. **"Emerging topic" is an incumbent feature.** Don't position against SciVal
   on feature-name; position on *transparency + price + self-serve*.
5. **OpenAlex taxonomy churn** — pin dataset/version, store field IDs (build
   plan already says this).
6. **Validation credibility.** FieldBridge must show *retrospective* validation
   (like LitGapFinder's hit-rate) — e.g., "gaps scored in 2021 that are now
   bridged, with precision measured." A gap score with no demonstrated hit-rate
   is a hypothesis, not a product claim.

## 7. What "class-leading" concretely requires (gaps vs current repo)

Current repo = Phase 0 foundation only (4-field matrix lib + OpenAlex pipeline
+ CLI + tests). To be class-leading *and* fundable:

1. **Full 19-field × 19-field live matrix** (OpenAlex fields) + domains layer,
   normalized for size and coverage. [Phase 1]
2. **Time series** (year-by-year flow) so "gap closing fastest" is real, not
   static. [Phase 2]
3. **Dual-signal gap score** (citation-flow gap × keyword/embedding drift) that
   *requires both signals to agree*, per the trend-engine spec, plus
   **retrospective hit-rate validation** as the credibility artifact. [Phase 3]
4. **Provenance/determinism** visible in the UI: every gap links to its
   snapshot, config version, and source matrix. [Phase 4]
5. **A revenue path** — institutional or R&D analytics layer (see §5), not
   freemium alone.

## 8. Sources

- VOSviewer/CiteSpace/Bibliometrix comparison — casrai.org/compare/vosviewer-vs-citespace-vs-bibliometrix (2026)
- Bibliometric tool evaluation reviews — doi.org/10.26761/ijrls.12.1.2026.2045; rclis.org/46901; ibj.pasteur.ac.ir/article-1-4521-en.pdf
- Literature-mapping tool comparisons (Connected Papers / Litmaps / ResearchRabbit / Inciteful / Open Knowledge Maps) — tesify.app (2026-06), ponder.ing (2026-07/08), citationmap.com, casrai.org/compare/connected-papers-alternatives
- SciVal Topics / Prominence / newly emerged Topics — elsevier.com/products/scival, service.elsevier.com, Scopus Support
- Clarivate Research Fronts 2025 (with CAS) — discover.clarivate.com, esi.help.clarivate.com
- Web of Science Research Intelligence launch — clarivate.com (2026-05-06), newswire.ca
- LitGapFinder — clawrxiv.io/abs/2603.00235 (2026-03)
- AI gap tools — questinno.com, fynman.com, paperguide.ai, acceptidea.com, frontierpath.io
- Funding — research-signals.com (2026-03), siliconangle.com (Mirendil, 2026-06), techfundingnews.com (Edison, 2025-12), startuprise.io (Network Bio, 2026-08)
- Science-heavy startup funding friction — ssti.org (Fosfuri & Nagar, Research Policy, 2026-02)
- OpenAlex tooling — bibliograph.it; github.com/LuisMRaimundo/Bibliometrics; OpenALEX Collector; paper-explorer; research-topic-explorer

---

## 9. Decision (locked 2026-09)

**Buyer:** Institutional / research offices. Position = "transparent SciVal on
open data" — reproducible frontier detection at a fraction of the price.

**Moat:** Transparency + validation. The formula is published openly
(LitGapFinder); the defensible asset is *execution*: every metric is a pure,
versioned, content-addressed function of stored data, and every surfaced gap
carries a retrospective hit-rate. Trust is the wedge against both the opaque
LLM entrants and the closed incumbents.

**Consequences for the roadmap (now binding):**

1. **Coverage normalization is a gate, not a feature.** Any pair where a
   field's refs resolve below `minCoverage` is suppressed from gap scoring —
   a coverage artifact must never be reported as a gap. Implemented in
   `src/lib/normalize.ts` + `src/lib/gaps.ts`.
2. **Dual-signal agreement is mandatory.** A gap requires sparse citation flow
   AND converging keyword/embedding similarity; one signal alone is not a gap.
   Implemented in `src/lib/gaps.ts`.
3. **Retrospective validation is a shipped artifact.** `src/lib/validation.ts`
   measures hit-rate / precision@k of surfaced gaps against later ground truth.
   The institutional sales story starts from this number, not from a feature
   list.
4. **Determinism is user-visible.** Every output prints engine version +
   config hash + snapshot reference (`src/cli.ts` run manifest).
5. **Revenue path:** institutional analytics layer (B) as the money, consumer
   matrix as the free public door (A).