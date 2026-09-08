import { STOPWORDS } from "./stopwords";

const TOKEN_RE = /[a-z][a-z-]{3,}/g;

/**
 * Token frequency over abstract texts, stopwords removed, top `topN` kept.
 * Tokens must start with a letter and be >=4 chars; lowercase.
 */
export function keywordCounts(texts: string[], topN = 200): Record<string, number> {
  const counts = new Map<string, number>();
  for (const t of texts) {
    for (const match of t.toLowerCase().matchAll(TOKEN_RE)) {
      const tok = match[0];
      if (!STOPWORDS.has(tok)) counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
  }
  return Object.fromEntries(
    [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN),
  );
}