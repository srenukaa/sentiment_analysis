"use client";

import { useCallback, useEffect, useState } from "react";
import { History as HistoryIcon, Search, Trash2, Loader2, Inbox } from "lucide-react";
import { SentimentBadge } from "@/components/sentiment-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn, relativeTime } from "@/lib/utils";
import { toast } from "sonner";

interface HistoryItem {
  id: string;
  text: string;
  label: string;
  score: number;
  source: string;
  channel: string | null;
  tokens: number;
  createdAt: string;
}

const LABELS = ["ALL", "POSITIVE", "NEUTRAL", "NEGATIVE"] as const;
const SOURCES = [
  { id: "all", label: "All sources" },
  { id: "manual", label: "Manual" },
  { id: "pulse", label: "Pulse Stream" },
  { id: "batch", label: "Batch" },
];

export function HistoryView() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState<(typeof LABELS)[number]>("ALL");
  const [source, setSource] = useState("all");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (label !== "ALL") params.set("label", label);
      if (source !== "all") params.set("source", source);
      if (q.trim()) params.set("q", q.trim());
      params.set("limit", "100");
      const res = await fetch(`/api/analyses?${params}`);
      const json = await res.json();
      setItems(json.items ?? []);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [label, source, q]);

  // Debounced reload on filter change
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const clearAll = async () => {
    try {
      await fetch("/api/analyses", { method: "DELETE" });
      setItems([]);
      toast.success("History cleared");
    } catch (e) {
      console.error(e);
      toast.error("Could not clear history");
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight flex items-center gap-2">
              <HistoryIcon className="h-5 w-5 text-clay" />
              History
            </h2>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed max-w-2xl">
              Every analysis you run — manual entries, pulse stream messages, and batch uploads —
              is stored locally in SQLite. Search, filter, and review past verdicts here.
            </p>
          </div>

          {items.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-negative hover:text-negative">
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Clear all
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all history?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes every analysis record and resets the daily
                    stats. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={clearAll}
                    className="bg-negative hover:bg-negative/90 text-white"
                  >
                    Delete everything
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {/* Filters */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by text…"
              className="pl-8 bg-background/60"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-background/40 p-0.5">
            {SOURCES.map((s) => (
              <button
                key={s.id}
                onClick={() => setSource(s.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  source === s.id
                    ? "bg-clay text-[var(--background)]"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {LABELS.map((l) => (
            <button
              key={l}
              onClick={() => setLabel(l)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors",
                label === l
                  ? "border-foreground/30 bg-foreground/5 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {l === "ALL" ? "All labels" : l.charAt(0) + l.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </section>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-10 text-center">
          <Inbox className="h-6 w-6 mx-auto text-muted-foreground/60 mb-2" />
          <h3 className="font-display text-base font-medium mb-1">Nothing here yet</h3>
          <p className="text-sm text-muted-foreground">
            Run some analyses in the Live Analyzer or Pulse Stream view to populate history.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={it.id}
              className="rounded-xl border border-border bg-card p-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <SentimentBadge label={it.label as "POSITIVE" | "NEGATIVE" | "NEUTRAL"} size="sm" />
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {it.source}
                  </span>
                  {it.channel && (
                    <span className="text-[11px] text-muted-foreground">· {it.channel}</span>
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {relativeTime(it.createdAt)}
                </span>
              </div>
              <p className="text-[15px] leading-relaxed text-foreground/90">{it.text}</p>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
                <span>{(it.score * 100).toFixed(1)}% confidence</span>
                <span className="h-3 w-px bg-border" />
                <span>{it.tokens} tokens</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
