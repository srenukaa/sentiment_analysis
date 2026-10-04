"use client";

import { useEffect, useState } from "react";
import { cn, relativeTime } from "@/lib/utils";

interface TickerItem {
  text: string;
  author: string;
  subreddit: string;
  permalink: string;
  postTitle: string;
  brand: string;
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
          posts?: Array<{
            postTitle: string;
            postBody: string;
            postAuthor: string;
            subreddit: string;
            postPermalink: string;
            postCreatedUtc: number;
            brand: { displayName: string };
          }>;
        };
        if (cancelled || !json.posts?.length) return;

        const mapped: TickerItem[] = json.posts.slice(0, 12).map((p) => ({
          // Use post body for sentiment heuristic, fall back to title
          text: (p.postBody || p.postTitle).length > 140
            ? (p.postBody || p.postTitle).slice(0, 140) + "…"
            : (p.postBody || p.postTitle),
          author: p.postAuthor,
          subreddit: p.subreddit,
          permalink: p.postPermalink,
          postTitle: p.postTitle,
          brand: p.brand.displayName,
          label: quickLabel(p.postBody || p.postTitle),
          at: p.postCreatedUtc * 1000,
        }));
        setItems(mapped);
      } catch {
        // Silent fail — the ticker is decorative.
      }
    };

    load();
    // Refresh every 5 minutes — Reddit's rate limit is ~1 req/43s per IP,
    // so the proxy caches results for 10 minutes. Polling faster just
    // returns the same cached data and burns CPU on marquee animation.
    timer = setInterval(load, 5 * 60_000);

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
              <a
                key={i}
                href={it.permalink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-xs hover:opacity-80 transition-opacity"
                title={`"${it.postTitle}" — click to view on Reddit`}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    it.label === "POSITIVE" && "bg-positive",
                    it.label === "NEGATIVE" && "bg-negative",
                    it.label === "NEUTRAL" && "bg-neutral-sent"
                  )}
                />
                <span className="text-muted-foreground shrink-0 font-medium">{it.brand}</span>
                <span className="text-foreground/75 max-w-[280px] truncate">{it.text}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">{relativeTime(new Date(it.at))}</span>
                <span className="text-border">·</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
