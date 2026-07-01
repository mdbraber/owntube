import { cosineSparse } from "@/server/recommendation/similarity";

/**
 * Common English function words, dropped at tokenization. They carry no topic
 * meaning, so they should neither drive the similarity score nor surface in the
 * "why recommended" explanation. (TF-IDF already down-weights them via low IDF;
 * removing them outright also avoids the residual noise on small corpora.)
 */
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "your",
  "our",
  "his",
  "her",
  "its",
  "their",
  "them",
  "they",
  "this",
  "that",
  "these",
  "those",
  "with",
  "from",
  "into",
  "onto",
  "than",
  "then",
  "has",
  "had",
  "have",
  "was",
  "were",
  "will",
  "would",
  "can",
  "could",
  "should",
  "about",
  "what",
  "which",
  "who",
  "whom",
  "whose",
  "when",
  "where",
  "all",
  "any",
  "some",
  "more",
  "most",
  "such",
  "only",
  "also",
  "just",
  "too",
  "very",
  "via",
  "out",
  "off",
  "per",
  "vs",
  // Contraction stems left after apostrophes are stripped (e.g. "isn't" → "isnt").
  "isnt",
  "dont",
  "doesnt",
  "didnt",
  "cant",
  "wont",
  "arent",
  "wasnt",
  "werent",
  "havent",
  "hasnt",
  "hadnt",
  "couldnt",
  "shouldnt",
  "wouldnt",
  "youre",
  "youll",
  "youve",
  "theyre",
  "thats",
  "theres",
  "heres",
  "whats",
  "ive",
  "aint",
]);

export function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      // Strip apostrophes first so contractions collapse ("isn't" → "isnt")
      // instead of leaving a stray fragment ("isn"); the stem is a stopword.
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
  );
}

export function documentFrequency(documents: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of documents) {
    const unique = new Set(doc);
    for (const t of unique) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  return df;
}

export function vectorizeTfIdf(
  doc: string[],
  df: Map<string, number>,
  docCount: number,
): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of doc) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  const len = doc.length || 1;
  const vec = new Map<string, number>();
  for (const [t, c] of tf) {
    const idf = Math.log((docCount + 1) / (1 + (df.get(t) ?? 0)));
    vec.set(t, (c / len) * idf);
  }
  return vec;
}

/**
 * Pre-computed TF-IDF model built once per recommendation pool. Holds the
 * document frequencies and one or more centroids so `similarity` can be called
 * per candidate without rebuilding the corpus vectors every time.
 */
export type TfidfModel = {
  /** Max cosine similarity of `title` against the model's centroid(s). 0 when empty. */
  similarity(title: string): number;
  /**
   * Top tokens of `title` that the user's taste corpus weighs on, ordered by
   * contribution (title term-frequency × best centroid weight). Used to explain
   * "why" a video was recommended. Empty when the model is empty or nothing overlaps.
   */
  explain(title: string, max?: number): string[];
  /** True when the corpus produced no usable tokens (similarity always 0). */
  readonly isEmpty: boolean;
};

const EMPTY_TFIDF_MODEL: TfidfModel = {
  similarity: () => 0,
  explain: () => [],
  isEmpty: true,
};

/**
 * Builds a reusable {@link TfidfModel} from a corpus of titles.
 *
 * With no `groups`, behaves exactly like the legacy single-centroid
 * `titleTfidfSimilarity` (one centroid pooled from the whole corpus). When
 * `groups` are supplied, an extra centroid is built per non-empty group and
 * `similarity` returns the **max** cosine across all centroids — so a candidate
 * matching a single interest is not diluted by the user's other interests.
 * The global pooled centroid is always included, so multi-centroid similarity is
 * never lower than the single-centroid value.
 */
export function buildTfidfModel(
  corpus: string[],
  opts?: { groups?: string[][] },
): TfidfModel {
  const docs = corpus.map(tokenize).filter((d) => d.length > 0);
  if (docs.length === 0) return EMPTY_TFIDF_MODEL;
  const df = documentFrequency(docs);
  const docCount = docs.length;

  const centroids: Map<string, number>[] = [
    vectorizeTfIdf(docs.flat(), df, docCount),
  ];
  for (const group of opts?.groups ?? []) {
    const pooled = group.flatMap(tokenize);
    if (pooled.length === 0) continue;
    centroids.push(vectorizeTfIdf(pooled, df, docCount));
  }

  return {
    isEmpty: false,
    similarity(title: string): number {
      const v = vectorizeTfIdf(tokenize(title), df, docCount);
      let best = 0;
      for (const centroid of centroids) {
        const sim = cosineSparse(v, centroid);
        if (sim > best) best = sim;
      }
      return best;
    },
    explain(title: string, max = 3): string[] {
      const tokens = tokenize(title);
      if (tokens.length === 0 || max <= 0) return [];
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      const contribution = new Map<string, number>();
      for (const [token, count] of tf) {
        let bestWeight = 0;
        for (const centroid of centroids) {
          const w = centroid.get(token) ?? 0;
          if (w > bestWeight) bestWeight = w;
        }
        if (bestWeight > 0) contribution.set(token, count * bestWeight);
      }
      return [...contribution.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, max)
        .map(([token]) => token);
    },
  };
}

/** Title similarity vs a corpus of other titles (content-based proxy for tags). */
export function titleTfidfSimilarity(title: string, corpus: string[]): number {
  return buildTfidfModel(corpus).similarity(title);
}

/**
 * Term-frequency vector for a single title — used for pairwise content
 * similarity in MMR diversification (no corpus / IDF needed, just token overlap).
 */
export function termFrequencyVector(title: string): Map<string, number> {
  const vec = new Map<string, number>();
  for (const t of tokenize(title)) {
    vec.set(t, (vec.get(t) ?? 0) + 1);
  }
  return vec;
}
