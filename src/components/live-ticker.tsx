"use client";

import { useEffect, useState } from "react";
import { cn, relativeTime } from "@/lib/utils";

interface TickerItem {
  text: string;
  author: string;
  subreddit: string;
  label: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  at: number;
}

/**
 * Top ticker — a decorative marquee strip showing real Reddit comments
 * tagged with a fast lexical heuristic. Uses the live Reddit proxy so the
 * strip always shows genuine customer voices, not canned samples.
 *
 * Does NOT use the HF model (the analyzer view does that). The ticker
 * is purely ambient context.
 */
const QUICK_LEX = {
  POSITIVE: ["love", "amazing", "great", "excellent", "best", "fantastic", "happy", "perfect", "wonderful", "brilliant", "delicious", "impressed", "flawless", "premium", "thrilled", "recommend", "awesome"],
  NEGATIVE: ["bad", "terrible", "worst", "broken", "hate", "awful", "disappointing", "rude", "cold", "soggy", "lag", "buffering", "waste", "frustrating", "unacceptable", "garbage", "scam"],
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
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const load = async () => {
      try {
        const res = await fetch(`/api/webhook/reddit-feed?channel=all&t=${Date.now()}`);
        if (!res.ok) return;
        const json = await res.json() as {
          items?: Array<{ text: string; author: string; subreddit: string; timestamp: number }>;
        };
        if (cancelled || !json.items?.length) return;

        const mapped: TickerItem[] = json.items.slice(0, 12).map((c) => ({
          text: c.text.length > 140 ? c.text.slice(0, 140) + "…" : c.text,
          author: c.author,
          subreddit: c.subreddit,
          label: quickLabel(c.text),
          at: c.timestamp * 1000,
        }));
        setItems(mapped);
      } catch {
        // Silent fail — the ticker is decorative.
      }
    };

    load();
    // Refresh every 60 seconds — Reddit's comments.json doesn't change faster
    timer = setInterval(load, 60_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (items.length === 0) return null;

  // Duplicate items for seamless marquee loop
  const doubled = [...items, ...items];

  return (
    <div className="relative overflow-hidden border-y border-border bg-canvas/60">
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5">
        <span className="relative inline-flex shrink-0">
          <span className="h-2 w-2 rounded-full bg-positive live-dot text-positive" />
        </span>
        <span className="eyebrow text-muted-foreground shrink-0 hidden sm:inline">Live Wire · Reddit</span>
        <div className="relative flex-1 overflow-hidden">
          <div className="flex items-center gap-8 animate-marquee whitespace-nowrap">
            {doubled.map((it, i) => (
              <span key={i} className="inline-flex items-center gap-2 text-xs">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    it.label === "POSITIVE" && "bg-positive",
                    it.label === "NEGATIVE" && "bg-negative",
                    it.label === "NEUTRAL" && "bg-neutral-sent"
                  )}
                />
                <span className="text-muted-foreground shrink-0">r/{it.subreddit}</span>
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
