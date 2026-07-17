import type { FeatureExtractionPipeline } from "@xenova/transformers";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

// Module-level singletons. `extractor` holds the loaded pipeline once ready;
// `loadingPromise` holds the in-flight load so concurrent cold-start callers
// share one download instead of each spawning their own.
let extractor: FeatureExtractionPipeline | null = null;
let loadingPromise: Promise<FeatureExtractionPipeline> | null = null;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;

  if (!loadingPromise) {
    // Lazy import so the model library is not pulled in at module import time.
    loadingPromise = import("@xenova/transformers").then(({ pipeline }) =>
      pipeline("feature-extraction", MODEL_ID)
    );
  }

  try {
    extractor = (await loadingPromise) as FeatureExtractionPipeline;
    return extractor;
  } catch (err) {
    // Reset so a failed cold start can be retried on the next call rather than
    // permanently poisoning the singleton.
    loadingPromise = null;
    throw err;
  }
}

/**
 * Embed `text` into a 384-dim normalized vector using all-MiniLM-L6-v2,
 * running fully in-process (no external API). First call downloads/caches the
 * model; subsequent calls reuse the loaded singleton.
 */
export async function embed(text: string): Promise<number[]> {
  const model = await getExtractor();
  const output = await model(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array | number[]);
}
