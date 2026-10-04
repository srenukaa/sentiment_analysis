"use client";

import { cn } from "@/lib/utils";
import type { SentimentLabel } from "@/lib/sentiment";

interface Props {
  label: SentimentLabel;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const MAP: Record<SentimentLabel, { text: string; bg: string; dot: string; label: string }> = {
  POSITIVE: {
    text: "text-positive",
    bg: "bg-positive/10 border-positive/25",
    dot: "bg-positive",
    label: "Positive",
  },
  NEGATIVE: {
    text: "text-negative",
    bg: "bg-negative/10 border-negative/25",
    dot: "bg-negative",
    label: "Negative",
  },
  NEUTRAL: {
    text: "text-neutral-sent",
    bg: "bg-neutral-sent/10 border-neutral-sent/25",
    dot: "bg-neutral-sent",
    label: "Neutral",
  },
};

const SIZE: Record<NonNullable<Props["size"]>, string> = {
  sm: "text-[10px] px-2 py-0.5 gap-1",
  md: "text-xs px-2.5 py-1 gap-1.5",
  lg: "text-sm px-3 py-1.5 gap-2",
};

const DOT_SIZE: Record<NonNullable<Props["size"]>, string> = {
  sm: "w-1 h-1",
  md: "w-1.5 h-1.5",
  lg: "w-2 h-2",
};

export function SentimentBadge({ label, size = "md", className }: Props) {
  const m = MAP[label];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium tracking-wide",
        m.bg,
        m.text,
        SIZE[size],
        className
      )}
    >
      <span className={cn("rounded-full", m.dot, DOT_SIZE[size])} />
      {m.label}
    </span>
  );
}
