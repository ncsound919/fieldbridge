/**
 * Stopword set used by keyword extraction. Mirrors the Phase 0 Python
 * implementation so Python/TS runs produce identical token streams.
 */
export const STOPWORDS = new Set(
  `a an the of and or to in for on with by from as at is are be been was were
this that these those we our it its their his her they them which who whom what when where how
not no can may might will would should could than then so such into over between within during
has have had do does did using used use results result study studies research paper papers
article articles approach approaches method methods analysis based new novel also however thus
therefore moreover furthermore well more most less least very much many few both each other`.split(
    /\s+/,
  ),
);