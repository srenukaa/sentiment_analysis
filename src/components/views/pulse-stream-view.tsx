"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Radio,
  Pause,
  Play,
  Square,
  Filter,
  AlertTriangle,
  Loader2,
  ExternalLink,
  MessageSquare,
} from "lucide-react";
import { useSentimentEngine } from "@/hooks/use-sentiment-engine";
import { SentimentBadge } from "@/components/sentiment-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CHANNELS } from "@/lib/channels";
import { cn, relativeTime } from "@/lib/utils";
import type { SentimentLabel, SentimentResult } from "@/lib/sentiment";

/**
 * Pulse Stream view — POST-LEVEL + THREAD SENTIMENT ANALYSIS.
 *
 * Pipeline:
 *   1. On Start, the view fetches thread posts from /api/webhook/reddit-feed.
 *      Each "post" is a brand-keyword-matched Reddit post + its top comments.
 *   2. Posts are pushed onto a local queue.
 *   3. A speed-driven interval pops one post off the queue at a time and
 *      runs TWO-TIER sentiment analysis:
 *        a) postSentiment — sentiment of the post body text
 *        b) commentsSentiment — aggregated sentiment of all comments
 *           (positive/neutral/negative percentage breakdown)
 *        c) overallThreadSentiment — combined verdict
 *   4. When the queue runs low, a fresh batch is fetched in the background.
 *   5. Rate-limits / network errors surface as a non-blocking banner.
 */

interface CommentData {
  id: string;
  text: string;
  author: string;
  authorProfileUrl: string;
  permalink: string;
  score: number;
  createdUtc: number;
}

interface ThreadPostData {
  id: string;
  postTitle: string;
  postBody: string;
  postAuthor: string;
  postAuthorProfileUrl: string;
  postPermalink: string;
  postCreatedUtc: number;
  postScore: number;
  subreddit: string;
  channel: string;
  channelLabel: string;
  brand: { key: string; displayName: string };
  comments: CommentData[];
}

interface FeedItem {
  post: ThreadPostData;
  postSentiment?: SentimentResult;
  commentsSentiment?: {
    positive: number;
    neutral: number;
    negative: number;
    total: number;
    label: SentimentLabel;
  };
  overallSentiment?: SentimentResult;
  status: "pending" | "done" | "error";
  arrivedAt: number;
}

type StreamState = "idle" | "running" | "paused";

interface FetchState {
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  warming: boolean;
}

const SPEEDS = [
  { ms: 6000, label: "Slow" },
  { ms: 3000, label: "Normal" },
  { ms: 1500, label: "Fast" },
];

const MAX_FEED_ITEMS = 20;

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
    warming: false,
  });

  const queueRef = useRef<ThreadPostData[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());

  const streamStateRef = useRef(streamState);
  const speedRef = useRef(speedIdx);
  const channelRef = useRef(activeChannel);
  useEffect(() => { streamStateRef.current = streamState; }, [streamState]);
  useEffect(() => { speedRef.current = speedIdx; }, [speedIdx]);
  useEffect(() => { channelRef.current = activeChannel; }, [activeChannel]);

  /**
   * Fetch a batch of thread posts from the Reddit proxy. Pushes new posts
   * onto the queue (skipping posts we've already seen).
   */
  const fetchBatch = useCallback(async () => {
    setFetchState((s) => ({ ...s, loading: true }));
    try {
      const ch = channelRef.current;
      const url = `/api/webhook/reddit-feed?channel=${encodeURIComponent(ch)}&t=${Date.now()}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
      const json = await res.json() as {
        ok: boolean;
        posts: ThreadPostData[];
        errors?: Array<{ channel: string; error: string }>;
        message?: string;
        warming?: boolean;
      };

      const fresh: ThreadPostData[] = [];
      for (const p of json.posts ?? []) {
        if (seenIdsRef.current.has(p.id)) continue;
        seenIdsRef.current.add(p.id);
        fresh.push(p);
      }

      if (fresh.length > 0) {
        queueRef.current.push(...fresh);
      }

      const proxyErrors = json.errors ?? [];
      const hasErrors = proxyErrors.length > 0;
      const isWarming = json.warming === true;

      setFetchState({
        loading: false,
        error: hasErrors
          ? `Partial fetch — ${proxyErrors.map((e) => e.channel).join(", ")}: ${proxyErrors[0]?.error}`
          : null,
        lastFetchedAt: Date.now(),
        warming: isWarming,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "network error";
      setFetchState({
        loading: false,
        error: `Could not reach the live feed proxy: ${msg}`,
        lastFetchedAt: Date.now(),
        warming: false,
      });
    }
  }, []);

  /**
   * Pop one post off the queue, run two-tier sentiment analysis:
   *   1. postSentiment — analyze the post body
   *   2. commentsSentiment — analyze each comment, aggregate to %
   *   3. overallSentiment — weighted combination
   */
  const tick = useCallback(async () => {
    try {
      await warm();
    } catch (e) {
      console.error("model warm-up failed", e);
    }

    // Refill queue if low
    if (queueRef.current.length <= 1) {
      void fetchBatch();
    }

    const next = queueRef.current.shift();
    if (!next) return;

    const item: FeedItem = {
      post: next,
      status: "pending",
      arrivedAt: Date.now(),
    };
    setItems((prev) => [item, ...prev].slice(0, MAX_FEED_ITEMS));

    try {
      // Tier 1: Post body sentiment
      const postSentiment = await run(next.postBody, {
        source: "pulse",
        channel: next.channel,
      });

      // Tier 2: Comments sentiment (aggregate)
      let commentsSentiment: FeedItem["commentsSentiment"];
      if (next.comments.length > 0) {
        const commentResults: SentimentResult[] = [];
        for (const c of next.comments) {
          try {
            const r = await run(c.text, { persist: false });
            commentResults.push(r);
          } catch {
            // skip failed comment
          }
        }
        if (commentResults.length > 0) {
          const pos = commentResults.filter((r) => r.label === "POSITIVE").length;
          const neg = commentResults.filter((r) => r.label === "NEGATIVE").length;
          const neu = commentResults.filter((r) => r.label === "NEUTRAL").length;
          const total = commentResults.length;
          const positivePct = pos / total;
          const negativePct = neg / total;
          const neutralPct = neu / total;
          // Determine dominant label
          let label: SentimentLabel = "NEUTRAL";
          if (positivePct >= negativePct && positivePct >= neutralPct) label = "POSITIVE";
          else if (negativePct >= positivePct && negativePct >= neutralPct) label = "NEGATIVE";
          commentsSentiment = {
            positive: positivePct,
            neutral: neutralPct,
            negative: negativePct,
            total,
            label,
          };
        }
      }

      // Overall: weight post + average of comments equally if comments exist,
      // otherwise just use post sentiment.
      let overallSentiment: SentimentResult;
      if (commentsSentiment) {
        // Combine: take post's positive/negative and mix with comments' breakdown
        const postWeight = 0.4;
        const commentsWeight = 0.6;
        const combinedPositive =
          postSentiment.positive * postWeight +
          commentsSentiment.positive * commentsWeight;
        const combinedNegative =
          postSentiment.negative * postWeight +
          commentsSentiment.negative * commentsWeight;
        const combinedNeutral =
          postSentiment.neutral * postWeight +
          commentsSentiment.neutral * commentsWeight;
        const maxConfidence = Math.max(combinedPositive, combinedNegative);
        let label: SentimentLabel;
        if (maxConfidence < 0.55) {
          label = "NEUTRAL";
        } else {
          label = combinedPositive > combinedNegative ? "POSITIVE" : "NEGATIVE";
        }
        overallSentiment = {
          label,
          score: maxConfidence,
          positive: combinedPositive,
          negative: combinedNegative,
          neutral: combinedNeutral,
        };
      } else {
        overallSentiment = postSentiment;
      }

      setItems((prev) =>
        prev.map((it) =>
          it.post.id === next.id
            ? { ...it, postSentiment, commentsSentiment, overallSentiment, status: "done" }
            : it
        )
      );
    } catch (e) {
      console.error("sentiment analysis failed", e);
      setItems((prev) =>
        prev.map((it) => (it.post.id === next.id ? { ...it, status: "error" } : it))
      );
    }
  }, [run, warm, fetchBatch]);

  // Interval loop
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

  // Channel switch resets the queue
  useEffect(() => {
    if (streamStateRef.current !== "running") return;
    queueRef.current = [];
    seenIdsRef.current = new Set();
    void fetchBatch();
  }, [activeChannel, fetchBatch]);

  const visibleItems = useMemo(() => {
    if (filterLabel === "ALL") return items;
    return items.filter((it) => it.overallSentiment?.label === filterLabel);
  }, [items, filterLabel]);

  const stats = useMemo(() => {
    const done = items.filter((i) => i.status === "done");
    const pos = done.filter((i) => i.overallSentiment?.label === "POSITIVE").length;
    const neg = done.filter((i) => i.overallSentiment?.label === "NEGATIVE").length;
    const neu = done.filter((i) => i.overallSentiment?.label === "NEUTRAL").length;
    return { total: done.length, pos, neg, neu };
  }, [items]);

  const startStream = () => {
    warm();
    setStreamState("running");
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
              Real Reddit posts discussing target brands (Netflix, Amazon, Zomato, etc.).
              Each thread is analyzed at two levels: the post body itself, and the aggregated
              sentiment of its comments. Click any card to inspect the original thread.
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
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Threads" value={stats.total} color="var(--ink)" />
            <Stat label="Positive" value={stats.pos} color="var(--positive)" />
            <Stat label="Neutral" value={stats.neu} color="var(--neutral-sent)" />
            <Stat label="Negative" value={stats.neg} color="var(--negative)" />
          </div>

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

        {/* Status row */}
        <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {fetchState.lastFetchedAt && (
              <>Last refresh: <span className="tabular-nums">{relativeTime(new Date(fetchState.lastFetchedAt))}</span></>
            )}
            {fetchState.warming && (
              <span className="ml-2 text-saffron">· Warming up Reddit cache (takes ~5 min for all channels)</span>
            )}
          </span>
          <span>Queue: <span className="tabular-nums">{queueRef.current.length}</span> threads waiting</span>
        </div>
      </section>

      {/* Error banner */}
      {fetchState.error && (
        <div className="rounded-xl border border-saffron/40 bg-saffron/10 px-4 py-3 flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 text-saffron shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-saffron mb-0.5">Live feed notice</div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {fetchState.error}
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
      <section className="space-y-3">
        {visibleItems.length === 0 && !fetchState.loading && !fetchState.warming && (
          <div className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-10 text-center">
            <Radio className="h-6 w-6 mx-auto text-muted-foreground/60 mb-2" />
            <p className="text-sm text-muted-foreground">
              No threads in the feed yet. Press <strong>Start stream</strong> above.
            </p>
          </div>
        )}
        {(visibleItems.length === 0 && (fetchState.loading || fetchState.warming)) && (
          <div className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-10 text-center">
            <Loader2 className="h-6 w-6 mx-auto text-muted-foreground/60 mb-3 animate-spin" />
            <p className="text-sm text-muted-foreground font-medium mb-1">
              {fetchState.warming ? "Warming up Reddit cache…" : "Fetching brand-keyword threads from Reddit…"}
            </p>
            <p className="text-xs text-muted-foreground/70 max-w-md mx-auto leading-relaxed">
              Reddit's RSS rate limit allows ~1 request per 45 seconds. The proxy fetches
              channels sequentially in the background. First threads should appear within ~60s.
            </p>
          </div>
        )}
        {visibleItems.map((it) => (
          <ThreadCard key={it.post.id} item={it} />
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

function ThreadCard({ item }: { item: FeedItem }) {
  const { post, postSentiment, commentsSentiment, overallSentiment, status } = item;

  return (
    <article className="animate-rise rounded-xl border border-border bg-card p-4 sm:p-5 shadow-sm hover:shadow-md transition-shadow">
      {/* Top row: brand badge + channel + author + timestamp + status */}
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {/* Brand badge */}
          <Badge className="bg-clay/10 text-clay border-clay/30 text-[10px] font-semibold uppercase tracking-wider shrink-0">
            {post.brand.displayName}
          </Badge>
          <Badge variant="outline" className="text-[10px] font-medium uppercase tracking-wider shrink-0">
            {post.channelLabel}
          </Badge>
          <span className="text-[11px] text-muted-foreground">r/{post.subreddit}</span>
          <span className="text-[11px] text-muted-foreground">·</span>
          <a
            href={post.postAuthorProfileUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors link-dotted"
          >
            u/{post.postAuthor}
          </a>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            · {relativeTime(new Date(post.postCreatedUtc * 1000))}
          </span>
        </div>
        {status === "pending" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-saffron animate-pulse" />
            analyzing
          </span>
        )}
        {status === "done" && overallSentiment && (
          <SentimentBadge label={overallSentiment.label} size="sm" />
        )}
        {status === "error" && (
          <span className="text-[11px] text-negative">failed</span>
        )}
      </div>

      {/* Post title — clickable, opens the thread on Reddit */}
      <a
        href={post.postPermalink}
        target="_blank"
        rel="noreferrer"
        className="group block mb-2"
        title="Open the original thread on Reddit"
      >
        <h3 className="font-display text-lg font-semibold leading-snug tracking-tight text-foreground group-hover:text-clay transition-colors">
          {post.postTitle}
        </h3>
      </a>

      {/* Post body text */}
      <p className="text-[14px] leading-relaxed text-foreground/80 mb-3 line-clamp-3">
        {post.postBody}
      </p>

      {/* Two-tier sentiment: post + comments breakdown */}
      {status === "done" && postSentiment && (
        <div className="grid gap-3 sm:grid-cols-2 mt-3 pt-3 border-t border-border/60">
          {/* Post sentiment */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="eyebrow text-muted-foreground">Post sentiment</span>
              <SentimentBadge label={postSentiment.label} size="sm" />
            </div>
            <div className="text-xs text-muted-foreground tabular-nums">
              confidence {(postSentiment.score * 100).toFixed(1)}%
            </div>
          </div>

          {/* Comments sentiment breakdown */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="eyebrow text-muted-foreground flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                Comments
              </span>
              {commentsSentiment ? (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {commentsSentiment.total} analyzed
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground/60">unavailable</span>
              )}
            </div>
            {commentsSentiment ? (
              <>
                {/* Mini breakdown bar */}
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="bg-positive transition-all duration-500" style={{ width: `${commentsSentiment.positive * 100}%` }} />
                  <div className="bg-neutral-sent transition-all duration-500" style={{ width: `${commentsSentiment.neutral * 100}%` }} />
                  <div className="bg-negative transition-all duration-500" style={{ width: `${commentsSentiment.negative * 100}%` }} />
                </div>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground tabular-nums">
                  <span className="text-positive">{(commentsSentiment.positive * 100).toFixed(0)}% pos</span>
                  <span className="text-neutral-sent">{(commentsSentiment.neutral * 100).toFixed(0)}% neu</span>
                  <span className="text-negative">{(commentsSentiment.negative * 100).toFixed(0)}% neg</span>
                </div>
              </>
            ) : (
              <div className="text-[10px] text-muted-foreground/60 italic">
                Comments couldn't be fetched (Reddit rate limit). Post sentiment used as overall.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer: view on Reddit link */}
      {status === "done" && (
        <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            Overall: {overallSentiment && (
              <span className="font-medium uppercase tracking-wide" style={{
                color:
                  overallSentiment.label === "POSITIVE" ? "var(--positive)" :
                  overallSentiment.label === "NEGATIVE" ? "var(--negative)" :
                  "var(--neutral-sent)"
              }}>
                {overallSentiment.label.toLowerCase()}
              </span>
            )}
            {" · "}confidence {(overallSentiment?.score ?? 0 * 100).toFixed(1)}%
          </span>
          <a
            href={post.postPermalink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors link-dotted"
            title="View the original thread on Reddit"
          >
            <ExternalLink className="h-3 w-3" />
            View thread on Reddit
          </a>
        </div>
      )}
    </article>
  );
}

function activeSubreddits(channel: string): string[] {
  if (channel === "all") return CHANNELS.map((c) => `r/${c.subreddit}`);
  const found = CHANNELS.find((c) => c.id === channel);
  return found ? [`r/${found.subreddit}`] : [];
}
