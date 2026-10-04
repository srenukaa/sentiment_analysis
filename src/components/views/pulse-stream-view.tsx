"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Radio, Pause, Play, Square, Filter, AlertTriangle, Loader2, ExternalLink } from "lucide-react";
import { useSentimentEngine } from "@/hooks/use-sentiment-engine";
import { SentimentBadge } from "@/components/sentiment-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CHANNELS } from "@/lib/channels";
import { cn, relativeTime } from "@/lib/utils";
import type { SentimentLabel, SentimentResult } from "@/lib/sentiment";

/**
 * Pulse Stream view — wired to the live Reddit proxy at /api/webhook/reddit-feed.
 *
 * Pipeline:
 *   1. On Start, the view fetches a batch of fresh comments from the proxy
 *      for the selected channel (or all channels).
 *   2. Comments are pushed onto a local queue.
 *   3. A speed-driven interval pops one item off the queue at a time and
 *      runs it through the in-browser sentiment engine.
 *   4. When the queue runs low, a fresh batch is fetched in the background.
 *   5. Rate-limits / network errors surface as a non-blocking banner so
 *      the feed keeps showing whatever it has already collected.
 */

interface FeedItem {
  id: string;
  text: string;
  author: string;
  authorProfileUrl: string;
  channel: string;
  channelLabel: string;
  subreddit: string;
  /** Direct permalink to this exact comment on reddit.com */
  permalink: string;
  /** Title of the post this comment is replying to */
  postTitle: string;
  /** Permalink to the parent post */
  postPermalink: string;
  redditTimestamp: number; // seconds since epoch
  result?: SentimentResult;
  status: "pending" | "done" | "error";
  arrivedAt: number;
}

type StreamState = "idle" | "running" | "paused";

interface FetchState {
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
}

const SPEEDS = [
  { ms: 5000, label: "Slow" },
  { ms: 2500, label: "Normal" },
  { ms: 1200, label: "Fast" },
];

const MAX_FEED_ITEMS = 30;
const QUEUE_LOW_WATERMARK = 3;

export function PulseStreamView() {
  const { run, warm } = useSentimentEngine();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [speedIdx, setSpeedIdx] = useState(1);
  const [activeChannel, setActiveChannel] = useState<string>("all");
  const [filterLabel, setFilterLabel] = useState<SentimentLabel | "ALL">("ALL");
  const [fetchState, setFetchState] = useState<FetchState>({
    loading: false,
    error: null,
    lastFetchedAt: null,
  });

  // Queue of fetched-but-not-yet-analyzed comments. Held in a ref so the
  // interval loop can drain it without re-rendering on every pop.
  const queueRef = useRef<FeedItem[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Mirror reactive state into refs so the interval closure always reads the
  // latest values without needing them as dependencies (which would
  // otherwise cancel and restart the interval on every change).
  const streamStateRef = useRef(streamState);
  const speedRef = useRef(speedIdx);
  const channelRef = useRef(activeChannel);
  useEffect(() => { streamStateRef.current = streamState; }, [streamState]);
  useEffect(() => { speedRef.current = speedIdx; }, [speedIdx]);
  useEffect(() => { channelRef.current = activeChannel; }, [activeChannel]);

  /**
   * Fetch a fresh batch of comments from the Reddit proxy. Pushes new items
   * onto the queue (skipping items we've already seen). Never throws —
   * errors land in fetchState.error so the UI can show a banner.
   */
  const fetchBatch = useCallback(async () => {
    if (fetchState.loading) return;
    setFetchState((s) => ({ ...s, loading: true }));
    try {
      const ch = channelRef.current;
      const url = `/api/webhook/reddit-feed?channel=${encodeURIComponent(ch)}&t=${Date.now()}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`proxy HTTP ${res.status}`);
      }
      const json = await res.json() as {
        ok: boolean;
        items: Array<{
          id: string;
          text: string;
          author: string;
          authorProfileUrl?: string;
          channel: string;
          channelLabel: string;
          subreddit: string;
          permalink: string;
          postTitle: string;
          postPermalink: string;
          timestamp: number;
        }>;
        errors?: Array<{ channel: string; error: string }>;
        message?: string;
      };

      const fresh: FeedItem[] = [];
      for (const c of json.items ?? []) {
        if (seenIdsRef.current.has(c.id)) continue;
        seenIdsRef.current.add(c.id);
        fresh.push({
          id: c.id,
          text: c.text,
          author: c.author,
          authorProfileUrl: c.authorProfileUrl ?? "",
          channel: c.channel,
          channelLabel: c.channelLabel,
          subreddit: c.subreddit,
          permalink: c.permalink,
          postTitle: c.postTitle,
          postPermalink: c.postPermalink,
          redditTimestamp: c.timestamp,
          status: "pending",
          arrivedAt: Date.now(),
        });
      }

      if (fresh.length > 0) {
        queueRef.current.push(...fresh);
      }

      // Surface proxy-side errors (e.g. Reddit rate-limited) but only if we
      // have nothing in the queue — otherwise the feed is still flowing.
      const proxyErrors = json.errors ?? [];
      const allFailed = json.ok === false && fresh.length === 0;
      setFetchState({
        loading: false,
        error: allFailed
          ? json.message ?? "Reddit is rate-limiting or unreachable."
          : proxyErrors.length > 0
            ? `Partial fetch — some subreddits returned errors: ${proxyErrors.map((e) => e.channel).join(", ")}`
            : null,
        lastFetchedAt: Date.now(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "network error";
      setFetchState({
        loading: false,
        error: `Could not reach the live feed proxy: ${msg}`,
        lastFetchedAt: Date.now(),
      });
    }
  }, [fetchState.loading]);

  /**
   * Pop one item off the queue, push it onto the visible feed, and run it
   * through the sentiment model. If the queue is running low, kick off a
   * background fetch.
   */
  const tick = useCallback(async () => {
    // Make sure the model is loaded before we start classifying.
    try {
      await warm();
    } catch (e) {
      console.error("model warm-up failed", e);
    }

    // Refill the queue if it's getting empty
    if (queueRef.current.length <= QUEUE_LOW_WATERMARK) {
      void fetchBatch();
    }

    const next = queueRef.current.shift();
    if (!next) return; // nothing to show yet — interval will retry next cycle

    // Push onto visible feed
    setItems((prev) => [next, ...prev].slice(0, MAX_FEED_ITEMS));

    // Run sentiment analysis
    try {
      const r = await run(next.text, { source: "pulse", channel: next.channel });
      setItems((prev) =>
        prev.map((it) => (it.id === next.id ? { ...it, result: r, status: "done" } : it))
      );
    } catch (e) {
      console.error("sentiment analysis failed", e);
      setItems((prev) =>
        prev.map((it) => (it.id === next.id ? { ...it, status: "error" } : it))
      );
    }
  }, [run, warm, fetchBatch]);

  // Interval loop — respects stream state and speed.
  useEffect(() => {
    if (streamState !== "running") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const loop = async () => {
      if (cancelled) return;
      await tick();
      if (cancelled) return;
      timer = setTimeout(loop, SPEEDS[speedRef.current].ms);
    };
    loop();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [streamState, tick]);

  // When the user changes the channel while streaming, reset the queue
  // and fetch a fresh batch immediately so the new channel is represented.
  useEffect(() => {
    if (streamStateRef.current !== "running") return;
    queueRef.current = [];
    seenIdsRef.current = new Set();
    void fetchBatch();
  }, [activeChannel, fetchBatch]);

  const visibleItems = useMemo(() => {
    if (filterLabel === "ALL") return items;
    return items.filter((it) => it.result?.label === filterLabel);
  }, [items, filterLabel]);

  const stats = useMemo(() => {
    const done = items.filter((i) => i.status === "done");
    const pos = done.filter((i) => i.result?.label === "POSITIVE").length;
    const neg = done.filter((i) => i.result?.label === "NEGATIVE").length;
    const neu = done.filter((i) => i.result?.label === "NEUTRAL").length;
    return { total: done.length, pos, neg, neu };
  }, [items]);

  const startStream = () => {
    warm();
    setStreamState("running");
    // Kick off an immediate fetch so the first item arrives ASAP
    void fetchBatch();
  };
  const pauseStream = () => setStreamState("paused");
  const stopStream = () => {
    setStreamState("idle");
    queueRef.current = [];
  };

  return (
    <div className="space-y-5">
      {/* Top control bar */}
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="relative inline-flex">
                <span className={cn("relative h-2 w-2 rounded-full",
                  streamState === "running" ? "bg-positive live-dot text-positive" :
                  streamState === "paused" ? "bg-saffron" : "bg-muted-foreground/40"
                )} />
              </span>
              <span className="eyebrow text-muted-foreground flex items-center gap-1.5">
                {streamState === "running" ? "Streaming live · " + activeSubreddits(activeChannel).join(", ") :
                 streamState === "paused" ? "Paused" : "Idle"}
                {fetchState.loading && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
              </span>
            </div>
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              Live Pulse Stream
            </h2>
            <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
              A live feed of real customer comments pulled from public discussion
              communities via our server-side proxy. Each incoming message is
              run through the in-browser sentiment model on arrival and
              classified in seconds.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {streamState === "idle" && (
              <Button onClick={startStream} className="bg-clay hover:bg-clay/90 text-[var(--background)]">
                <Play className="h-4 w-4 mr-1.5" />
                Start stream
              </Button>
            )}
            {streamState === "running" && (
              <Button onClick={pauseStream} variant="outline">
                <Pause className="h-4 w-4 mr-1.5" />
                Pause
              </Button>
            )}
            {streamState === "paused" && (
              <Button onClick={() => setStreamState("running")} className="bg-clay hover:bg-clay/90 text-[var(--background)]">
                <Play className="h-4 w-4 mr-1.5" />
                Resume
              </Button>
            )}
            {streamState !== "idle" && (
              <Button onClick={stopStream} variant="ghost" size="icon" aria-label="Stop">
                <Square className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Stats + speed + channel */}
        <div className="mt-5 grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          {/* Stats block */}
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Total" value={stats.total} color="var(--ink)" />
            <Stat label="Positive" value={stats.pos} color="var(--positive)" />
            <Stat label="Neutral" value={stats.neu} color="var(--neutral-sent)" />
            <Stat label="Negative" value={stats.neg} color="var(--negative)" />
          </div>

          {/* Speed selector */}
          <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
            <div className="eyebrow text-muted-foreground mb-1.5">Speed</div>
            <div className="flex gap-1">
              {SPEEDS.map((s, i) => (
                <button
                  key={s.label}
                  onClick={() => setSpeedIdx(i)}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                    speedIdx === i
                      ? "bg-clay text-[var(--background)]"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Channel filter */}
          <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
            <div className="eyebrow text-muted-foreground mb-1.5">Channel</div>
            <select
              value={activeChannel}
              onChange={(e) => setActiveChannel(e.target.value)}
              className="w-full bg-transparent text-sm font-medium focus:outline-none cursor-pointer"
            >
              <option value="all">All channels</option>
              {CHANNELS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Last fetched + error banner */}
        {fetchState.lastFetchedAt && (
          <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              Last refresh: <span className="tabular-nums">{relativeTime(new Date(fetchState.lastFetchedAt))}</span>
            </span>
            <span>
              Queue: <span className="tabular-nums">{queueRef.current.length}</span> comments waiting
            </span>
          </div>
        )}
      </section>

      {/* Error banner — non-blocking */}
      {fetchState.error && (
        <div className="rounded-xl border border-saffron/40 bg-saffron/10 px-4 py-3 flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 text-saffron shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-saffron mb-0.5">
              Live feed notice
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {fetchState.error} The feed keeps showing what was already collected.
              New attempts happen automatically in the background.
            </p>
          </div>
        </div>
      )}

      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-muted-foreground mr-1" />
        <span className="text-xs text-muted-foreground mr-1">Filter:</span>
        {(["ALL", "POSITIVE", "NEUTRAL", "NEGATIVE"] as const).map((l) => (
          <button
            key={l}
            onClick={() => setFilterLabel(l)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors",
              filterLabel === l
                ? "border-foreground/30 bg-foreground/5 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {l === "ALL" ? "All" : l.charAt(0) + l.slice(1).toLowerCase()}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {visibleItems.length} of {items.length} shown
        </span>
      </div>

      {/* Live feed */}
      <section className="space-y-2.5">
        {visibleItems.length === 0 && !fetchState.loading && (
          <div className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-10 text-center">
            <Radio className="h-6 w-6 mx-auto text-muted-foreground/60 mb-2" />
            <p className="text-sm text-muted-foreground">
              No messages in the feed yet. Press <strong>Start stream</strong> above.
            </p>
          </div>
        )}
        {visibleItems.length === 0 && fetchState.loading && (
          <div className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-10 text-center">
            <Loader2 className="h-6 w-6 mx-auto text-muted-foreground/60 mb-2 animate-spin" />
            <p className="text-sm text-muted-foreground">
              Fetching live comments from Reddit…
            </p>
          </div>
        )}
        {visibleItems.map((it) => (
          <FeedCard key={it.id} item={it} />
        ))}
      </section>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 px-2.5 py-2 text-center">
      <div className="eyebrow text-muted-foreground mb-1">{label}</div>
      <div className="font-display text-xl font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function FeedCard({ item }: { item: FeedItem }) {
  return (
    <article className="animate-rise rounded-xl border border-border bg-card p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow">
      {/* Top row: channel badge, author, timestamp, sentiment badge */}
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <Badge variant="outline" className="text-[10px] font-medium uppercase tracking-wider shrink-0">
            {item.channelLabel}
          </Badge>
          {item.authorProfileUrl ? (
            <a
              href={item.authorProfileUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors link-dotted"
            >
              u/{item.author}
            </a>
          ) : (
            <span className="text-[11px] text-muted-foreground">u/{item.author}</span>
          )}
          <span className="text-[11px] text-muted-foreground tabular-nums">
            · {relativeTime(new Date(item.redditTimestamp * 1000))}
          </span>
        </div>
        {item.status === "pending" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-saffron animate-pulse" />
            analyzing
          </span>
        )}
        {item.status === "done" && item.result && (
          <SentimentBadge label={item.result.label} size="sm" />
        )}
        {item.status === "error" && (
          <span className="text-[11px] text-negative">failed</span>
        )}
      </div>

      {/* Post title (context) — clickable to open the parent post on Reddit */}
      <a
        href={item.postPermalink}
        target="_blank"
        rel="noreferrer"
        className="group flex items-start gap-1.5 mb-2 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
        title="Open the original post on Reddit"
      >
        <span className="font-medium uppercase tracking-wide text-[10px] text-muted-foreground/70 mt-0.5 shrink-0">
          On
        </span>
        <span className="font-display italic text-foreground/80 group-hover:text-foreground transition-colors line-clamp-2">
          “{item.postTitle}”
        </span>
      </a>

      {/* The actual comment text */}
      <p className="text-[15px] leading-relaxed text-foreground/90">{item.text}</p>

      {/* Footer: confidence + sentiment breakdown + view-on-reddit links */}
      {item.status === "done" && item.result && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
          <span className="tabular-nums">
            confidence {(item.result.score * 100).toFixed(1)}%
          </span>
          <span className="h-3 w-px bg-border" />
          <span className="tabular-nums">
            pos {(item.result.positive * 100).toFixed(0)}% ·
            neu {(item.result.neutral * 100).toFixed(0)}% ·
            neg {(item.result.negative * 100).toFixed(0)}%
          </span>
          <span className="h-3 w-px bg-border" />
          <a
            href={item.permalink}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 link-dotted hover:text-foreground transition-colors"
            title="View this exact comment on Reddit"
          >
            <ExternalLink className="h-3 w-3" />
            View on Reddit
          </a>
        </div>
      )}
    </article>
  );
}

/**
 * Returns the list of subreddit tags (e.g. "r/BuyItForLife") for the
 * currently selected channel, used to display
 * "Streaming live · r/BuyItForLife, r/doordash…" in the eyebrow.
 */
function activeSubreddits(channel: string): string[] {
  if (channel === "all") return CHANNELS.map((c) => `r/${c.subreddit}`);
  const found = CHANNELS.find((c) => c.id === channel);
  return found ? [`r/${found.subreddit}`] : [];
}
