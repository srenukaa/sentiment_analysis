"use client";

/**
 * Sentira sentiment engine — thin client wrapper around
 * @huggingface/transformers running the
 * `Xenova/distilbert-base-uncased-finetuned-sst-2-english` model.
 *
 * The model is small (~66 MB quantized) and runs entirely in the browser
 * via WASM — no API key, no server inference. This is what makes the
 * project a true "real-time use case" solution: works offline after
 * first load, low latency, private.
 */

import { pipeline, env, type Pipeline } from "@huggingface/transformers";

// Disable local model caching to avoid SSR/file-system lookups.
// Allow remote downloads from the HF hub.
env.allowLocalModels = false;
env.useBrowserCache = true;

export type SentimentLabel = "POSITIVE" | "NEGATIVE" | "NEUTRAL";

export interface SentimentResult {
  label: SentimentLabel;
  score: number; // 0..1 confidence in chosen label
  positive: number; // 0..1
  negative: number; // 0..1
  neutral: number; // 0..1 (derived)
}

export type ModelStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error";

type ProgressCb = (progress: number) => void;

let sentimentPipeline: Pipeline | null = null;
let loadPromise: Promise<Pipeline> | null = null;
let currentStatus: ModelStatus = "idle";

const listeners = new Set<(s: ModelStatus) => void>();

export function subscribeModelStatus(cb: (s: ModelStatus) => void) {
  listeners.add(cb);
  cb(currentStatus);
  return () => listeners.delete(cb);
}

function setStatus(s: ModelStatus) {
  currentStatus = s;
  listeners.forEach((l) => l(s));
}

export function getModelStatus() {
  return currentStatus;
}

/**
 * Lazily load the HF model. Returns the cached pipeline once loaded.
 * Safe to call concurrently — only the first call triggers a download.
 */
export async function loadModel(onProgress?: ProgressCb): Promise<Pipeline> {
  if (sentimentPipeline) return sentimentPipeline;
  if (loadPromise) return loadPromise;

  setStatus("loading");

  loadPromise = pipeline("text-classification", "Xenova/distilbert-base-uncased-finetuned-sst-2-english", {
    quantized: true,
    progress_callback: (data: { progress?: number }) => {
      if (typeof data?.progress === "number") {
        onProgress?.(Math.min(100, Math.round(data.progress)));
      }
    },
  }) as Promise<Pipeline>;

  try {
    sentimentPipeline = await loadPromise;
    setStatus("ready");
    return sentimentPipeline;
  } catch (err) {
    setStatus("error");
    loadPromise = null;
    throw err;
  }
}

/**
 * Run sentiment analysis on a single text. The DistilBERT-SST-2 model
 * outputs POSITIVE / NEGATIVE with a softmax score. We map anything
 * with both classes < 0.55 confidence to NEUTRAL — gives the UI a
 * believable 3-class output for borderline texts (e.g. pure facts).
 */
export async function analyzeSentiment(text: string): Promise<SentimentResult> {
  const pipe = await loadModel();
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      label: "NEUTRAL",
      score: 0,
      positive: 0,
      negative: 0,
      neutral: 1,
    };
  }

  const output = (await pipe(trimmed, { topk: 2 })) as Array<{
    label: string;
    score: number;
  }>;

  // Output may be a single object or an array depending on topk — normalize.
  const results = Array.isArray(output) ? output : [output];

  let positive = 0;
  let negative = 0;
  for (const r of results) {
    if (r.label === "POSITIVE") positive = r.score;
    else if (r.label === "NEGATIVE") negative = r.score;
  }

  // If neither class dominates clearly, treat as neutral.
  const maxConfidence = Math.max(positive, negative);
  let label: SentimentLabel;
  let neutral: number;

  if (maxConfidence < 0.55) {
    label = "NEUTRAL";
    // Spread the remaining probability across three classes for the gauge.
    neutral = 1 - maxConfidence;
    // Normalize so all three sum to 1
    const sum = positive + negative + neutral;
    positive = positive / sum;
    negative = negative / sum;
    neutral = neutral / sum;
  } else {
    label = positive > negative ? "POSITIVE" : "NEGATIVE";
    neutral = 0;
  }

  return {
    label,
    score: maxConfidence,
    positive,
    negative,
    neutral,
  };
}

/**
 * Batch helper — runs analysis on an array of texts sequentially.
 * DistilBERT-SST-2 doesn't support batching reliably through transformers.js
 * in all environments, so we go one at a time but yield between calls
 * to keep the UI responsive on mobile.
 */
export async function analyzeBatch(
  texts: string[],
  onItem?: (i: number, r: SentimentResult) => void
): Promise<SentimentResult[]> {
  const out: SentimentResult[] = [];
  for (let i = 0; i < texts.length; i++) {
    const r = await analyzeSentiment(texts[i]);
    out.push(r);
    onItem?.(i, r);
    // Yield to event loop so paint can happen
    await new Promise((res) => setTimeout(res, 0));
  }
  return out;
}
