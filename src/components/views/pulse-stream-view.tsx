"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Radio, Pause, Play, Square, ChevronDown, Filter } from "lucide-react";
import { useSentimentEngine } from "@/hooks/use-sentiment-engine";
import { SentimentBadge } from "@/components/sentiment-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CHANNELS, type ChannelDef } from "@/lib/channels";
import { cn, relativeTime, sample } from "@/lib/utils";
import type { SentimentLabel, SentimentResult } from "@/lib/sentiment";

interface FeedItem {
  id: string;
  text: string;
  channel: string;
  channelLabel: string;
  result?: SentimentResult;
  status: "pending" | "done" | "error";
  arrivedAt: number;
}

type StreamState = "idle" | "running" | "paused";

const SPEEDS = [
  { ms: 5000, label: "Slow" },
  { ms: 2500, label: "Normal" },
  { ms: 1200, label: "Fast" },
];

export function PulseStreamView() {
  const { run, warm } = useSentimentEngine();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [streamState, setStreamState] = useState<StreamState>("idle");
  const [speedIdx, setSpeedIdx] = useState(1);
  const [activeChannel, setActiveChannel] = useState<string>("all");
  const [filterLabel, setFilterLabel] = useState<SentimentLabel | "ALL">("ALL");

  const streamStateRef = useRef(streamState);
  const speedRef = useRef(speedIdx);
  const channelRef = useRef(activeChannel);
  useEffect(() => { streamStateRef.current = streamState; }, [streamState]);
  useEffect(() => { speedRef.current = speedIdx; }, [speedIdx]);
  useEffect(() => { channelRef.current = activeChannel; }, [activeChannel]);

  const tick = useCallback(async () => {
    // Don't run if model not ready yet — warm it
    await warm();

    // Pick a channel
    const channelPool: ChannelDef[] =
      channelRef.current === "all" ? CHANNELS : CHANNELS.filter((c) => c.id === channelRef.current);
    if (channelPool.length === 0) return;
    const ch = sample(channelPool);
    const text = sample(ch.samples);

    const id = `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const item: FeedItem = {
      id,
      text,
      channel: ch.id,
      channelLabel: ch.label,
      status: "pending",
      arrivedAt: Date.now(),
    };
    setItems((prev) => [item, ...prev].slice(0, 30));

    try {
      const r = await run(text, { source: "pulse", channel: ch.id });
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, result: r, status: "done" } : it))
      );
    } catch (e) {
      console.error(e);
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, status: "error" } : it))
      );
    }
  }, [run, warm]);

  // Interval loop — respects stream state and speed
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
  };
  const pauseStream = () => setStreamState("paused");
  const stopStream = () => {
    setStreamState("idle");
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
              <span className="eyebrow text-muted-foreground">
                {streamState === "running" ? "Streaming live" :
                 streamState === "paused" ? "Paused" : "Idle"}
              </span>
            </div>
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              Live Pulse Stream
            </h2>
            <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
              A simulated real-time feed of customer feedback across four verticals.
              Each incoming message is run through the model on arrival and classified in seconds.
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
      </section>

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
        {visibleItems.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-10 text-center">
            <Radio className="h-6 w-6 mx-auto text-muted-foreground/60 mb-2" />
            <p className="text-sm text-muted-foreground">
              No messages in the feed yet. Press <strong>Start stream</strong> above.
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
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] font-medium uppercase tracking-wider">
            {item.channelLabel}
          </Badge>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {relativeTime(new Date(item.arrivedAt))}
          </span>
        </div>
        {item.status === "pending" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
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
      <p className="text-[15px] leading-relaxed text-foreground/90">{item.text}</p>
      {item.status === "done" && item.result && (
        <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="tabular-nums">
            confidence {(item.result.score * 100).toFixed(1)}%
          </span>
          <span className="h-3 w-px bg-border" />
          <span>
            pos {(item.result.positive * 100).toFixed(0)}% ·
            neu {(item.result.neutral * 100).toFixed(0)}% ·
            neg {(item.result.negative * 100).toFixed(0)}%
          </span>
        </div>
      )}
    </article>
  );
}
