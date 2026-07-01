/** Cosine similarity for sparse weight maps (token → weight). */
export function cosineSparse(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const v of a.values()) na += v * v;
  for (const v of b.values()) nb += v * v;
  if (na === 0 || nb === 0) return 0;
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (vb !== undefined) dot += va * vb;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
