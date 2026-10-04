"use client";

import { useCallback, useEffect, useState } from "react";
import { analyzeSentiment, loadModel, subscribeModelStatus, type ModelStatus, type SentimentResult } from "@/lib/sentiment";

/**
 * Central hook used by every view. Holds:
 *  - model status (idle/loading/ready/error) and load progress
 *  - a `run` function that performs analysis and persists via API
 */
export function useSentimentEngine() {
  const [status, setStatus] = useState<ModelStatus>("idle");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const unsub = subscribeModelStatus(setStatus);
    return () => {
      unsub();
    };
  }, []);

  const warm = useCallback(async () => {
    if (status === "idle") {
      try {
        await loadModel(setProgress);
      } catch (e) {
        console.error("model load failed", e);
      }
    }
  }, [status]);

  const run = useCallback(async (text: string, opts?: { source?: string; channel?: string; persist?: boolean }) => {
    const result = await analyzeSentiment(text);
    if (opts?.persist !== false) {
      try {
        await fetch("/api/analyses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            label: result.label,
            score: result.score,
            source: opts?.source ?? "manual",
            channel: opts?.channel ?? null,
          }),
        });
      } catch (e) {
        // Persist failure should not block the UI
        console.warn("failed to persist analysis", e);
      }
    }
    return result;
  }, []);

  return { status, progress, warm, run };
}

export type { SentimentResult };
