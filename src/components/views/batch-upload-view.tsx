"use client";

import { useCallback, useRef, useState, useMemo, useEffect } from "react";
import {
  Upload,
  FileText,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Download,
  RefreshCw,
  ArrowRight,
  X,
} from "lucide-react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { useSentimentEngine } from "@/hooks/use-sentiment-engine";
import { SentimentBadge } from "@/components/sentiment-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, relativeTime } from "@/lib/utils";
import type { SentimentResult } from "@/lib/sentiment";
import { toast } from "sonner";

/**
 * Batch Upload view — analyze sentiment across an entire dataset.
 *
 * Pipeline:
 *   1. User uploads a CSV or PDF file via drag-drop or click.
 *   2. The file is sent to /api/upload/batch which parses it and
 *      returns up to 200 text snippets.
 *   3. Each snippet is run through the in-browser HF model (one at a
 *      time, with a yield between calls so the UI stays responsive).
 *   4. As results come in, the table populates row-by-row and the
 *      dataset-level analytics update live.
 *   5. User can download the annotated CSV with sentiment labels.
 */

interface ParsedRow {
  id: string;
  text: string;
  source: "csv" | "pdf";
  meta: Record<string, unknown>;
}

interface AnalyzedRow extends ParsedRow {
  result?: SentimentResult;
  status: "pending" | "done" | "error";
}

type Phase = "idle" | "uploading" | "analyzing" | "done" | "error";

interface FileMeta {
  name: string;
  type: "csv" | "pdf";
  totalRows: number;
}

const LABEL_COLORS: Record<string, string> = {
  POSITIVE: "var(--positive)",
  NEGATIVE: "var(--negative)",
  NEUTRAL: "var(--neutral-sent)",
};

const ACCEPTED_TYPES = ".csv,.pdf,text/csv,application/pdf";

export function BatchUploadView() {
  const { run, warm } = useSentimentEngine();
  const [phase, setPhase] = useState<Phase>("idle");
  const [rows, setRows] = useState<AnalyzedRow[]>([]);
  const [fileMeta, setFileMeta] = useState<FileMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analyzedCount, setAnalyzedCount] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analyzeAbortRef = useRef(false);

  // Warm the model on mount
  useEffect(() => {
    warm();
  }, [warm]);

  const reset = useCallback(() => {
    analyzeAbortRef.current = true;
    setPhase("idle");
    setRows([]);
    setFileMeta(null);
    setError(null);
    setAnalyzedCount(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setRows([]);
      setFileMeta(null);
      setAnalyzedCount(0);
      analyzeAbortRef.current = false;

      const ext = file.name.toLowerCase().split(".").pop() ?? "";
      if (ext !== "csv" && ext !== "pdf") {
        setError(`Unsupported file type: .${ext}. Please upload a CSV or PDF file.`);
        setPhase("error");
        return;
      }

      setPhase("uploading");

      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload/batch", {
          method: "POST",
          body: formData,
        });
        const json = await res.json();
        if (!json.ok) {
          throw new Error(json.error ?? "Failed to parse file");
        }

        const parsedRows = json.rows as ParsedRow[];
        setFileMeta({
          name: json.fileName,
          type: json.fileType,
          totalRows: json.totalRows,
        });

        // Initialize analyzed rows as pending
        setRows(parsedRows.map((r) => ({ ...r, status: "pending" as const })));
        setPhase("analyzing");

        // Make sure the model is loaded before we start the batch
        try {
          await warm();
        } catch {
          // ignore — the run() call will warm it anyway
        }

        // Run sentiment analysis sequentially with yields between calls
        for (let i = 0; i < parsedRows.length; i++) {
          if (analyzeAbortRef.current) return;
          const row = parsedRows[i];
          try {
            const result = await run(row.text, { source: "batch" });
            setRows((prev) =>
              prev.map((r) => (r.id === row.id ? { ...r, result, status: "done" } : r))
            );
          } catch (e) {
            console.error("analysis failed for row", i, e);
            setRows((prev) =>
              prev.map((r) => (r.id === row.id ? { ...r, status: "error" } : r))
            );
          }
          setAnalyzedCount(i + 1);
          // Yield to event loop so paint can happen
          await new Promise((res) => setTimeout(res, 0));
        }

        setPhase("done");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "upload failed";
        setError(msg);
        setPhase("error");
      }
    },
    [run, warm]
  );

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => setIsDragging(false);

  // Analytics derived from analyzed rows
  const stats = useMemo(() => {
    const done = rows.filter((r) => r.status === "done" && r.result);
    const pos = done.filter((r) => r.result!.label === "POSITIVE");
    const neg = done.filter((r) => r.result!.label === "NEGATIVE");
    const neu = done.filter((r) => r.result!.label === "NEUTRAL");
    const avgConfidence = done.length > 0
      ? done.reduce((acc, r) => acc + r.result!.score, 0) / done.length
      : 0;
    return {
      total: done.length,
      pos: pos.length,
      neg: neg.length,
      neu: neu.length,
      avgConfidence,
    };
  }, [rows]);

  const distributionData = useMemo(
    () => [
      { name: "Positive", value: stats.pos, color: LABEL_COLORS.POSITIVE },
      { name: "Neutral", value: stats.neu, color: LABEL_COLORS.NEUTRAL },
      { name: "Negative", value: stats.neg, color: LABEL_COLORS.NEGATIVE },
    ],
    [stats]
  );

  const topPositive = useMemo(
    () =>
      rows
        .filter((r) => r.status === "done" && r.result?.label === "POSITIVE")
        .sort((a, b) => (b.result!.score ?? 0) - (a.result!.score ?? 0))
        .slice(0, 3),
    [rows]
  );

  const topNegative = useMemo(
    () =>
      rows
        .filter((r) => r.status === "done" && r.result?.label === "NEGATIVE")
        .sort((a, b) => (b.result!.score ?? 0) - (a.result!.score ?? 0))
        .slice(0, 3),
    [rows]
  );

  // Download annotated CSV
  const downloadCSV = () => {
    const header = "text,label,confidence,positive,neutral,negative,source\n";
    const csvRows = rows
      .filter((r) => r.status === "done" && r.result)
      .map((r) => {
        const text = r.text.replace(/"/g, '""').replace(/\n/g, " ");
        const { label, score, positive, negative, neutral } = r.result!;
        return `"${text}","${label}",${(score * 100).toFixed(2)}%,${(positive * 100).toFixed(2)}%,${(neutral * 100).toFixed(2)}%,${(negative * 100).toFixed(2)}%,${r.source}`;
      });
    const csv = header + csvRows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sentira-${fileMeta?.name ?? "batch"}-annotated.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Annotated CSV downloaded");
  };

  const isWorking = phase === "uploading" || phase === "analyzing";
  const progressPct = fileMeta && fileMeta.totalRows > 0
    ? Math.round((analyzedCount / fileMeta.totalRows) * 100)
    : 0;

  return (
    <div className="space-y-5">
      {/* Upload zone — shown when idle or after reset */}
      {phase === "idle" && (
        <section
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={cn(
            "rounded-2xl border-2 border-dashed p-10 sm:p-16 text-center transition-all",
            isDragging
              ? "border-clay bg-clay/5 scale-[1.01]"
              : "border-border/70 bg-card/50 hover:border-clay/50 hover:bg-clay/[0.02]"
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            onChange={onFileInputChange}
            className="hidden"
            aria-label="Upload CSV or PDF file"
          />
          <div className="flex flex-col items-center gap-4">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-clay/10 text-clay">
              <Upload className="h-7 w-7" strokeWidth={2} />
            </div>
            <div className="space-y-1.5">
              <h3 className="font-display text-2xl font-semibold tracking-tight">
                Upload a dataset for analysis
              </h3>
              <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
                Drag and drop a CSV or PDF file, or click to browse.
                Each row/paragraph will be analyzed for sentiment in your browser.
              </p>
            </div>
            <Button
              onClick={() => fileInputRef.current?.click()}
              className="bg-clay hover:bg-clay/90 text-[var(--background)]"
              size="lg"
            >
              <Upload className="h-4 w-4 mr-1.5" />
              Choose file
            </Button>
            <div className="flex items-center gap-4 text-[11px] text-muted-foreground mt-2">
              <span className="flex items-center gap-1">
                <FileSpreadsheet className="h-3 w-3" />
                CSV (with text/review/comment column)
              </span>
              <span className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                PDF (text extracted per paragraph)
              </span>
              <span>Max 10 MB · 200 rows</span>
            </div>
          </div>
        </section>
      )}

      {/* Error state */}
      {phase === "error" && (
        <section className="rounded-2xl border border-negative/40 bg-negative/10 p-8 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto text-negative mb-3" />
          <h3 className="font-display text-lg font-semibold mb-1">Upload failed</h3>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <Button onClick={reset} variant="outline">
            <RefreshCw className="h-4 w-4 mr-1.5" />
            Try again
          </Button>
        </section>
      )}

      {/* Working state — upload + analysis progress */}
      {isWorking && (
        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            {fileMeta?.type === "csv" ? (
              <FileSpreadsheet className="h-5 w-5 text-clay" />
            ) : (
              <FileText className="h-5 w-5 text-clay" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{fileMeta?.name ?? "Processing…"}</div>
              <div className="text-xs text-muted-foreground">
                {phase === "uploading"
                  ? "Parsing file on the server…"
                  : `Analyzing ${analyzedCount} of ${fileMeta?.totalRows ?? 0} rows`}
              </div>
            </div>
            <Loader2 className="h-5 w-5 animate-spin text-clay" />
          </div>

          {/* Progress bar */}
          {phase === "analyzing" && (
            <div className="space-y-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-clay transition-all duration-300 ease-out"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
                <span>{progressPct}% complete</span>
                <span>
                  {stats.pos} pos · {stats.neu} neu · {stats.neg} neg
                </span>
              </div>
            </div>
          )}

          {/* Live partial results while analyzing */}
          {phase === "analyzing" && stats.total > 0 && (
            <div className="mt-4 pt-4 border-t border-border/60">
              <div className="eyebrow text-muted-foreground mb-2">Live results so far</div>
              <div className="grid grid-cols-4 gap-2">
                <MiniStat label="Done" value={stats.total} color="var(--ink)" />
                <MiniStat label="Positive" value={stats.pos} color="var(--positive)" />
                <MiniStat label="Neutral" value={stats.neu} color="var(--neutral-sent)" />
                <MiniStat label="Negative" value={stats.neg} color="var(--negative)" />
              </div>
            </div>
          )}
        </section>
      )}

      {/* Done state — analytics + results table */}
      {phase === "done" && (
        <>
          {/* Summary bar */}
          <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3">
                {fileMeta?.type === "csv" ? (
                  <FileSpreadsheet className="h-5 w-5 text-clay" />
                ) : (
                  <FileText className="h-5 w-5 text-clay" />
                )}
                <div>
                  <div className="text-sm font-medium">{fileMeta?.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {fileMeta?.totalRows} rows analyzed · {fileMeta?.type.toUpperCase()}
                  </div>
                </div>
                <CheckCircle2 className="h-4 w-4 text-positive ml-2" />
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={downloadCSV} variant="outline" size="sm">
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Download CSV
                </Button>
                <Button onClick={reset} variant="ghost" size="sm">
                  <X className="h-3.5 w-3.5 mr-1.5" />
                  Reset
                </Button>
              </div>
            </div>

            {/* KPI cards */}
            <div className="grid gap-3 sm:grid-cols-4">
              <Kpi label="Total analyzed" value={stats.total.toString()} icon={<FileText className="h-4 w-4" />} />
              <Kpi label="Avg confidence" value={`${(stats.avgConfidence * 100).toFixed(1)}%`} icon={<CheckCircle2 className="h-4 w-4" />} />
              <Kpi
                label="Positive"
                value={`${stats.total > 0 ? Math.round((stats.pos / stats.total) * 100) : 0}%`}
                icon={<ArrowRight className="h-4 w-4" />}
                color="var(--positive)"
              />
              <Kpi
                label="Negative"
                value={`${stats.total > 0 ? Math.round((stats.neg / stats.total) * 100) : 0}%`}
                icon={<ArrowRight className="h-4 w-4" />}
                color="var(--negative)"
              />
            </div>
          </section>

          {/* Charts + insights */}
          <div className="grid gap-5 lg:grid-cols-2">
            {/* Distribution donut */}
            <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
              <h3 className="font-display text-lg font-semibold tracking-tight mb-1">
                Sentiment distribution
              </h3>
              <p className="text-xs text-muted-foreground mb-4">
                Breakdown across all {stats.total} analyzed rows.
              </p>
              <div className="flex items-center">
                <div className="h-[200px] w-1/2">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={distributionData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={45}
                        outerRadius={75}
                        paddingAngle={2}
                      >
                        {distributionData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2 w-1/2 pl-2">
                  {distributionData.map((d) => {
                    const pct = stats.total > 0 ? (d.value / stats.total) * 100 : 0;
                    return (
                      <div key={d.name} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                          <span>{d.name}</span>
                        </div>
                        <div className="flex items-center gap-2 tabular-nums">
                          <span className="font-medium">{d.value}</span>
                          <span className="text-xs text-muted-foreground">({pct.toFixed(0)}%)</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Sentiment count bar chart */}
            <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
              <h3 className="font-display text-lg font-semibold tracking-tight mb-1">
                Volume by sentiment
              </h3>
              <p className="text-xs text-muted-foreground mb-4">
                Absolute count of each sentiment class.
              </p>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={distributionData} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="value" name="Count" radius={[6, 6, 0, 0]}>
                      {distributionData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          {/* Top positive + negative samples */}
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <span className="h-2.5 w-2.5 rounded-full bg-positive" />
                <h3 className="font-display text-base font-semibold tracking-tight">
                  Top positive samples
                </h3>
              </div>
              {topPositive.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No positive samples found.</p>
              ) : (
                <ul className="space-y-2.5">
                  {topPositive.map((r) => (
                    <li key={r.id} className="rounded-lg border border-border/60 bg-background/40 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <SentimentBadge label="POSITIVE" size="sm" />
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {(r.result!.score * 100).toFixed(1)}% confidence
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed text-foreground/85 line-clamp-2">{r.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <span className="h-2.5 w-2.5 rounded-full bg-negative" />
                <h3 className="font-display text-base font-semibold tracking-tight">
                  Top negative samples
                </h3>
              </div>
              {topNegative.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No negative samples found.</p>
              ) : (
                <ul className="space-y-2.5">
                  {topNegative.map((r) => (
                    <li key={r.id} className="rounded-lg border border-border/60 bg-background/40 p-3">
                      <div className="flex items-center justify-between mb-1">
                        <SentimentBadge label="NEGATIVE" size="sm" />
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {(r.result!.score * 100).toFixed(1)}% confidence
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed text-foreground/85 line-clamp-2">{r.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Full results table */}
          <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
            <h3 className="font-display text-lg font-semibold tracking-tight mb-4">
              All results ({stats.total} rows)
            </h3>
            <div className="max-h-[500px] overflow-y-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">#</th>
                    <th className="text-left px-3 py-2 font-medium">Text</th>
                    <th className="text-left px-3 py-2 font-medium">Sentiment</th>
                    <th className="text-right px-3 py-2 font-medium">Confidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r, i) => (
                    <tr key={r.id} className="hover:bg-muted/40 transition-colors">
                      <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2.5 max-w-md">
                        <p className="text-foreground/85 line-clamp-2 leading-relaxed">{r.text}</p>
                        <div className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wide">
                          {r.source}
                          {r.meta.page ? ` · p.${r.meta.page}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {r.status === "done" && r.result && (
                          <SentimentBadge label={r.result.label} size="sm" />
                        )}
                        {r.status === "pending" && (
                          <span className="text-[11px] text-muted-foreground">…</span>
                        )}
                        {r.status === "error" && (
                          <span className="text-[11px] text-negative">error</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-muted-foreground tabular-nums">
                        {r.result ? `${(r.result.score * 100).toFixed(1)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background/40 p-4">
      <div className="flex items-center justify-between mb-2">
        <span
          className="grid h-8 w-8 place-items-center rounded-lg bg-clay/10"
          style={color ? { color } : { color: "var(--clay)" }}
        >
          {icon}
        </span>
      </div>
      <div className="font-display text-2xl font-semibold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">
        {label}
      </div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 px-2.5 py-2 text-center">
      <div className="eyebrow text-muted-foreground mb-1">{label}</div>
      <div className="font-display text-lg font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
