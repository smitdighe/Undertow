export const DEDUPE_THRESHOLD = 0.87;

/** Minimal shape needed for dedupe — an incident id plus its stored embedding. */
export interface EmbeddedIncident {
  id: string;
  embedding: number[] | null | undefined;
}

export interface DedupeMatch {
  id: string;
  similarity: number;
}

/**
 * Cosine similarity of two equal-length vectors.
 * Throws on dimension mismatch rather than returning a silent NaN.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Embedding dimension mismatch: ${a.length} vs ${b.length}`
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0; // zero vector — no meaningful direction
  return dot / denom;
}

/**
 * Return the single best open incident whose embedding is >= `threshold`
 * cosine-similar to `embedding`, or null if none qualify.
 *
 * - Empty pool -> null (no error).
 * - Incidents with null/missing embeddings are skipped.
 * - Dimension mismatch throws a clear error (never a silent NaN comparison).
 * - Single O(n) pass over the pool.
 */
export function findDuplicate(
  embedding: number[],
  openIncidents: EmbeddedIncident[],
  threshold: number = DEDUPE_THRESHOLD
): DedupeMatch | null {
  let best: DedupeMatch | null = null;

  for (const incident of openIncidents) {
    const other = incident.embedding;
    if (!other || other.length === 0) continue; // skip null/missing/empty

    const similarity = cosineSimilarity(embedding, other);
    if (similarity >= threshold && (best === null || similarity > best.similarity)) {
      best = { id: incident.id, similarity };
    }
  }

  return best;
}
