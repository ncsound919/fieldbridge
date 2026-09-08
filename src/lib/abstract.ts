import type { Work } from "./types";

/**
 * Rebuild abstract text from OpenAlex `abstract_inverted_index`.
 * Empty index -> empty string.
 */
export function abstractText(invertedIndex: Work["abstract_inverted_index"]): string {
  if (!invertedIndex) return "";
  const positions = new Map<number, string>();
  for (const [word, idxs] of Object.entries(invertedIndex)) {
    for (const i of idxs) positions.set(i, word);
  }
  return [...positions.keys()]
    .sort((a, b) => a - b)
    .map((i) => positions.get(i))
    .join(" ");
}