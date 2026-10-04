"use client";

import { Loader2, CheckCircle2, AlertTriangle, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { subscribeModelStatus, type ModelStatus } from "@/lib/sentiment";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  progress?: number;
}

export function ModelStatusPill({ className, progress }: Props) {
  const [status, setStatus] = useState<ModelStatus>("idle");
  useEffect(() => subscribeModelStatus(setStatus), []);

  const map: Record<ModelStatus, { icon: React.ReactNode; text: string; cls: string }> = {
    idle: {
      icon: <Download className="h-3 w-3" />,
      text: "Model ready to load",
      cls: "bg-muted/60 text-muted-foreground border-border",
    },
    loading: {
      icon: <Loader2 className="h-3 w-3 animate-spin" />,
      text:
        progress && progress > 0
          ? `Loading model · ${progress}%`
          : "Loading model from Hugging Face…",
      cls: "bg-[var(--saffron)]/15 text-[var(--saffron)] border-[var(--saffron)]/30",
    },
    ready: {
      icon: <CheckCircle2 className="h-3 w-3" />,
      text: "Model ready · DistilBERT-SST-2",
      cls: "bg-[var(--positive)]/12 text-[var(--positive)] border-[var(--positive)]/30",
    },
    error: {
      icon: <AlertTriangle className="h-3 w-3" />,
      text: "Failed to load model — check connection",
      cls: "bg-[var(--negative)]/12 text-[var(--negative)] border-[var(--negative)]/30",
    },
  };

  const m = map[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        m.cls,
        className
      )}
    >
      {m.icon}
      <span className="truncate max-w-[260px]">{m.text}</span>
    </span>
  );
}
