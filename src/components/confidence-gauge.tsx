"use client";

import { cn } from "@/lib/utils";
import type { SentimentResult } from "@/lib/sentiment";

interface Props {
  result?: SentimentResult;
  pending?: boolean;
  className?: string;
}

/**
 * Three-bar confidence gauge — shows the live distribution of
 * POSITIVE / NEGATIVE / NEUTRAL probabilities as a horizontal stacked bar.
 * Used in the Live Analyzer view.
 */
export function ConfidenceGauge({ result, pending, className }: Props) {
  const pos = result?.positive ?? 0;
  const neg = result?.negative ?? 0;
  const neu = result?.neutral ?? 0;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        <span>Confidence distribution</span>
        {pending && <span className="text-[var(--clay)]">analyzing…</span>}
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
        {/* Stacked bars */}
        <div className="flex h-full w-full">
          <div
            className="h-full bg-[var(--positive)] transition-all duration-500 ease-out"
            style={{ width: `${pos * 100}%` }}
          />
          <div
            className="h-full bg-[var(--neutral-sent)] transition-all duration-500 ease-out"
            style={{ width: `${neu * 100}%` }}
          />
          <div
            className="h-full bg-[var(--negative)] transition-all duration-500 ease-out"
            style={{ width: `${neg * 100}%` }}
          />
        </div>
        {/* Subtle texture overlay */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 to-transparent" />
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="Positive" value={pos} color="var(--positive)" />
        <Stat label="Neutral" value={neu} color="var(--neutral-sent)" />
        <Stat label="Negative" value={neg} color="var(--negative)" />
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card/50 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <span className="font-display text-base font-medium tabular-nums">
        {(value * 100).toFixed(1)}%
      </span>
    </div>
  );
}
