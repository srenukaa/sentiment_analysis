"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, Type, Eraser, Loader2, ArrowRight } from "lucide-react";
import { useSentimentEngine } from "@/hooks/use-sentiment-engine";
import { SentimentBadge } from "@/components/sentiment-badge";
import { ConfidenceGauge } from "@/components/confidence-gauge";
import { ModelStatusPill } from "@/components/model-status-pill";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn, pct, sample } from "@/lib/utils";
import type { SentimentResult } from "@/lib/sentiment";

const EXAMPLES = [
  "The new phone is amazing, the camera quality blew me away on the first day itself.",
  "Delivery was three days late and the box was damaged when it finally arrived.",
  "It's a phone. Makes calls, sends texts, nothing fancy but works.",
  "Honestly the best customer support experience I have ever had, resolved in minutes.",
];

export function LiveAnalyzerView() {
  const { status, progress, warm, run } = useSentimentEngine();
  const [text, setText] = useState("");
  const [result, setResult] = useState<SentimentResult | null>(null);
  const [pending, setPending] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  // Warm the model on first mount
  useEffect(() => {
    warm();
  }, [warm]);

  // Debounced auto-analysis as the user types
  const trigger = useCallback(
    (value: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (value.trim().length < 4) {
        setResult(null);
        setPending(false);
        return;
      }
      setPending(true);
      const mySeq = ++seqRef.current;
      debounceRef.current = setTimeout(async () => {
        try {
          const r = await run(value, { source: "manual" });
          // Only commit if this is the latest trigger
          if (mySeq === seqRef.current) {
            setResult(r);
          }
        } catch (e) {
          console.error(e);
        } finally {
          if (mySeq === seqRef.current) setPending(false);
        }
      }, 350);
    },
    [run]
  );

  const onChange = (v: string) => {
    setText(v);
    trigger(v);
  };

  const clearAll = () => {
    setText("");
    setResult(null);
    setPending(false);
  };

  const charCount = text.length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      {/* Left: input panel */}
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <Type className="h-4 w-4 text-[var(--clay)]" />
            <h2 className="font-display text-xl font-semibold tracking-tight">
              Compose your text
            </h2>
          </div>
          <ModelStatusPill progress={progress} />
        </div>

        <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
          Type or paste any text below — a product review, a tweet, a support message —
          and the model will classify it as positive, negative, or neutral in real time.
          Analysis runs as you type, with a 350 ms debounce.
        </p>

        <div className="relative">
          <Textarea
            value={text}
            onChange={(e) => onChange(e.target.value)}
            placeholder="e.g. The packaging was beautiful and the product works exactly as described — I am impressed."
            className="min-h-[160px] sm:min-h-[200px] resize-none text-[15px] leading-relaxed bg-background/60 border-border/80 focus-visible:ring-[var(--clay)]/40"
            aria-label="Text to analyze"
          />
          {pending && (
            <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-background/90 backdrop-blur px-2.5 py-1 text-[11px] text-muted-foreground border border-border">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>analyzing</span>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="tabular-nums">{charCount} chars</span>
            <span className="h-3 w-px bg-border" />
            <span className="tabular-nums">{wordCount} words</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange(sample(EXAMPLES))}
              className="text-muted-foreground hover:text-foreground"
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Try an example
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={clearAll}
              disabled={!text}
            >
              <Eraser className="h-3.5 w-3.5 mr-1.5" />
              Clear
            </Button>
          </div>
        </div>
      </section>

      {/* Right: result panel */}
      <section
        className={cn(
          "rounded-2xl border bg-card p-5 sm:p-6 shadow-sm transition-colors",
          result ? "border-border" : "border-dashed border-border/70"
        )}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl font-semibold tracking-tight">Verdict</h2>
          {result && <SentimentBadge label={result.label} size="lg" />}
        </div>

        {!result && !pending && (
          <EmptyState />
        )}

        {pending && !result && (
          <SkeletonResult />
        )}

        {result && (
          <div className="space-y-5">
            <ConfidenceGauge result={result} pending={pending} />

            <div className="grid grid-cols-2 gap-3 pt-2">
              <Metric label="Confidence" value={pct(result.score)} />
              <Metric
                label="Verdict"
                value={
                  result.label.charAt(0) +
                  result.label.slice(1).toLowerCase()
                }
              />
            </div>

            <div className="rounded-lg border border-border/70 bg-background/40 p-3.5">
              <div className="eyebrow text-muted-foreground mb-1.5">Interpretation</div>
              <p className="text-sm leading-relaxed text-foreground/90">
                {interpretation(result, text)}
              </p>
            </div>

            <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground">
              <ArrowRight className="h-3 w-3" />
              <span>Saved to local history — visible in the History tab.</span>
            </div>
          </div>
        )}
      </section>

      {/* Examples strip */}
      <section className="lg:col-span-2">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-px flex-1 bg-border" />
          <span className="eyebrow text-muted-foreground">Or pick a sample</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {EXAMPLES.map((ex, i) => (
            <button
              key={i}
              onClick={() => onChange(ex)}
              className="group rounded-xl border border-border bg-card p-4 text-left hover:border-[var(--clay)]/50 hover:bg-[var(--clay)]/[0.03] transition-colors"
            >
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground mb-2">
                Sample {i + 1}
              </div>
              <p className="text-sm leading-relaxed line-clamp-3 text-foreground/85">
                {ex}
              </p>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/40 px-3.5 py-2.5">
      <div className="eyebrow text-muted-foreground mb-1">{label}</div>
      <div className="font-display text-lg font-medium tabular-nums">{value}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--clay)]/10 text-[var(--clay)] mb-3">
        <Type className="h-5 w-5" />
      </div>
      <h3 className="font-display text-base font-medium mb-1">
        Start typing to see the verdict
      </h3>
      <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
        Sentiment analysis runs locally in your browser via a quantized
        DistilBERT model from Hugging Face — no data leaves your device.
      </p>
    </div>
  );
}

function SkeletonResult() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="space-y-2">
        <div className="h-3 w-40 bg-muted rounded" />
        <div className="h-3 w-full bg-muted rounded-full" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 bg-muted rounded-md" />
        ))}
      </div>
      <div className="h-20 bg-muted rounded-lg" />
    </div>
  );
}

function interpretation(r: SentimentResult, text: string): string {
  const len = text.trim().split(/\s+/).length;
  switch (r.label) {
    case "POSITIVE":
      return `The text reads as ${pct(r.positive)} positive in tone. The model picked up on affirming cues such as praise, satisfaction, or enthusiasm. ${len > 12 ? "Despite the longer length, the sentiment signal remained consistent." : "Short and to the point — high signal-to-noise ratio."}`;
    case "NEGATIVE":
      return `The text reads as ${pct(r.negative)} negative in tone. Likely contains complaints, frustration, or disappointment cues. ${r.score > 0.9 ? "Confidence is very high — the language is unambiguous." : "Confidence is moderate — the negativity is present but qualified."}`;
    case "NEUTRAL":
      return `Neither class dominated: positive ${pct(r.positive)}, negative ${pct(r.negative)}. The text reads as factual, mixed, or too short for a clear stance. Often seen with product specs, instructions, or balanced feedback.`;
  }
}
