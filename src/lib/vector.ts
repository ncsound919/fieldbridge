/** Cosine similarity between two `{token: count}` maps. */
export function cosine(a: Record<string, number>, b: Record<string, number>): number {
  let num = 0;
  let da = 0;
  let db = 0;
  for (const [k, v] of Object.entries(a)) {
    da += v * v;
    if (k in b) num += v * b[k]!;
  }
  for (const v of Object.values(b)) db += v * v;
  const denom = Math.sqrt(da) * Math.sqrt(db);
  return denom > 0 ? num / denom : 0;
}