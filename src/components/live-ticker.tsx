"use client";

import { useEffect, useState } from "react";
import { cn, relativeTime, sample } from "@/lib/utils";
import { ALL_SAMPLES } from "@/lib/channels";

interface TickerItem {
  text: string;
  label: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  at: number;
}

/**
 * Top ticker — shows a faux "live sentiment in the wild" strip.
 * Pulls a random sample every few seconds, tags it with a sentiment
 * using a quick heuristic (so it doesn't depend on the HF model warming up).
 *
 * Used purely as decorative context, not as the source of truth.
 */
const QUICK_LEX = {
  POSITIVE: ["love", "amazing", "great", "excellent", "best", "fantastic", "happy", "perfect", "wonderful", "brilliant", "delicious", "impressed", "flawless", "premium", "thrilled"],
  NEGATIVE: ["bad", "terrible", "worst", "broken", "hate", "awful", "disappointing", "rude", "cold", "soggy", "lag", "buffering", "waste", "frustrating", "unacceptable"],
};

function quickLabel(text: string): TickerItem["label"] {
  const lower = text.toLowerCase();
  let pos = 0;
  let neg = 0;
  for (const w of QUICK_LEX.POSITIVE) if (lower.includes(w)) pos++;
  for (const w of QUICK_LEX.NEGATIVE) if (lower.includes(w)) neg++;
  if (pos > neg) return "POSITIVE";
  if (neg > pos) return "NEGATIVE";
  return "NEUTRAL";
}

export function LiveTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);

  useEffect(() => {
    const seed: TickerItem[] = Array.from({ length: 8 }, () => {
      const s = sample(ALL_SAMPLES);
      return { text: s.text, label: quickLabel(s.text), at: Date.now() };
    });

    // Defer the initial state update outside the effect body to avoid cascading renders.
    const seedTimer = setTimeout(() => setItems(seed), 0);

    const interval = setInterval(() => {
      const s = sample(ALL_SAMPLES);
      setItems((prev) =>
        [...prev.slice(-7), { text: s.text, label: quickLabel(s.text), at: Date.now() }]
      );
    }, 4500);

    return () => {
      clearTimeout(seedTimer);
      clearInterval(interval);
    };
  }, []);

  if (items.length === 0) return null;

  // Duplicate items for seamless marquee loop
  const doubled = [...items, ...items];

  return (
    <div className="relative overflow-hidden border-y border-border bg-[var(--canvas)]/60">
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5">
        <span className="relative inline-flex shrink-0">
          <span className="h-2 w-2 rounded-full bg-[var(--positive)] live-dot text-[var(--positive)]" />
        </span>
        <span className="eyebrow text-muted-foreground shrink-0 hidden sm:inline">Live Wire</span>
        <div className="relative flex-1 overflow-hidden">
          <div className="flex items-center gap-8 animate-marquee whitespace-nowrap">
            {doubled.map((it, i) => (
              <span key={i} className="inline-flex items-center gap-2 text-xs">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    it.label === "POSITIVE" && "bg-[var(--positive)]",
                    it.label === "NEGATIVE" && "bg-[var(--negative)]",
                    it.label === "NEUTRAL" && "bg-[var(--neutral-sent)]"
                  )}
                />
                <span className="text-foreground/75 max-w-[280px] truncate">{it.text}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">{relativeTime(new Date(it.at))}</span>
                <span className="text-border">·</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
