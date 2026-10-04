"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import { BarChart3, Loader2, TrendingUp, Layers, MessageSquare } from "lucide-react";
import { SentimentBadge } from "@/components/sentiment-badge";
import { relativeTime } from "@/lib/utils";

interface StatsData {
  total: number;
  tokens: number;
  byLabel: { label: string; count: number }[];
  bySource: { source: string; count: number }[];
  byChannel: { channel: string; count: number }[];
  daily: { date: string; positive: number; negative: number; neutral: number; total: number }[];
  recent: { id: string; text: string; label: string; score: number; createdAt: string; source: string }[];
}

const LABEL_COLORS: Record<string, string> = {
  POSITIVE: "var(--positive)",
  NEGATIVE: "var(--negative)",
  NEUTRAL: "var(--neutral-sent)",
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  pulse: "Pulse Stream",
  batch: "Batch",
};

const CHANNEL_LABELS: Record<string, string> = {
  ecommerce: "E-Commerce",
  "food-delivery": "Food Delivery",
  streaming: "Streaming",
  support: "Support",
};

export function AnalyticsView() {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/stats?days=7");
        if (!res.ok) throw new Error("fetch failed");
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        console.error(e);
        if (!cancelled) setErr("Could not load analytics. Try analyzing some text first.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (err || !data) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-10 text-center">
        <p className="text-sm text-muted-foreground">{err}</p>
      </div>
    );
  }

  if (data.total === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 bg-card/50 p-10 text-center">
        <BarChart3 className="h-6 w-6 mx-auto text-muted-foreground/60 mb-2" />
        <h3 className="font-display text-lg font-medium mb-1">No data yet</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
          Run some analyses in the Live Analyzer or Pulse Stream views, then come back here
          to see distribution charts, trends, and channel breakdowns.
        </p>
      </div>
    );
  }

  const labelPieData = ["POSITIVE", "NEGATIVE", "NEUTRAL"].map((label) => {
    const found = data.byLabel.find((b) => b.label === label);
    return { name: label, value: found?.count ?? 0 };
  });

  const channelData = data.byChannel.map((c) => ({
    name: CHANNEL_LABELS[c.channel ?? ""] ?? c.channel,
    count: c.count,
  }));

  const sourceData = data.bySource.map((s) => ({
    name: SOURCE_LABELS[s.source] ?? s.source,
    count: s.count,
  }));

  const dailyData = data.daily.map((d) => ({
    name: new Date(d.date).toLocaleDateString([], { month: "short", day: "numeric" }),
    positive: d.positive,
    negative: d.negative,
    neutral: d.neutral,
    total: d.total,
  }));

  // Trend direction — compare last two days
  const trend = dailyData.length >= 2
    ? dailyData[dailyData.length - 1].total - dailyData[dailyData.length - 2].total
    : 0;

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={<MessageSquare className="h-4 w-4" />}
          label="Total analyses"
          value={data.total.toString()}
          sub="across all sources"
        />
        <Kpi
          icon={<TrendingUp className="h-4 w-4" />}
          label="Today vs yesterday"
          value={trend > 0 ? `+${trend}` : trend === 0 ? "0" : trend.toString()}
          sub={`${dailyData[dailyData.length - 1]?.total ?? 0} today`}
          trend={trend}
        />
        <Kpi
          icon={<Layers className="h-4 w-4" />}
          label="Tokens processed"
          value={data.tokens.toLocaleString()}
          sub="rough estimate"
        />
        <Kpi
          icon={<BarChart3 className="h-4 w-4" />}
          label="Avg confidence"
          value={`${avgConfidence(data).toFixed(1)}%`}
          sub="across all results"
        />
      </section>

      {/* Trend area chart */}
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display text-lg font-semibold tracking-tight">
              Sentiment trend · last 7 days
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Daily volume split by sentiment class.
            </p>
          </div>
        </div>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailyData} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gPos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--positive)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--positive)" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="gNeu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--neutral-sent)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--neutral-sent)" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="gNeg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--negative)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--negative)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
              />
              <Area type="monotone" dataKey="positive" name="Positive" stroke="var(--positive)" strokeWidth={2} fill="url(#gPos)" />
              <Area type="monotone" dataKey="neutral" name="Neutral" stroke="var(--neutral-sent)" strokeWidth={2} fill="url(#gNeu)" />
              <Area type="monotone" dataKey="negative" name="Negative" stroke="var(--negative)" strokeWidth={2} fill="url(#gNeg)" />
              <Legend
                wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                iconType="circle"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Pie — label distribution */}
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
          <h3 className="font-display text-lg font-semibold tracking-tight mb-1">
            Label distribution
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            All-time split across every analysis.
          </p>
          <div className="h-[240px] flex items-center">
            <div className="h-full w-1/2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={labelPieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {labelPieData.map((entry, i) => (
                      <Cell key={i} fill={LABEL_COLORS[entry.name]} />
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
            <div className="space-y-2.5 w-1/2 pl-2">
              {labelPieData.map((entry) => {
                const pct = data.total > 0 ? (entry.value / data.total) * 100 : 0;
                return (
                  <div key={entry.name} className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: LABEL_COLORS[entry.name] }}
                      />
                      <span className="text-foreground/85">
                        {entry.name.charAt(0) + entry.name.slice(1).toLowerCase()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 tabular-nums">
                      <span className="font-medium">{entry.value}</span>
                      <span className="text-xs text-muted-foreground">
                        ({pct.toFixed(0)}%)
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Bar — channel breakdown */}
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
          <h3 className="font-display text-lg font-semibold tracking-tight mb-1">
            Volume by channel
          </h3>
          <p className="text-xs text-muted-foreground mb-4">
            Where your analyzed feedback is coming from.
          </p>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={channelData} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" name="Count" fill="var(--clay)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* Source breakdown underneath */}
          <div className="mt-4 pt-4 border-t border-border">
            <div className="eyebrow text-muted-foreground mb-2">By source</div>
            <div className="flex flex-wrap gap-2">
              {sourceData.map((s) => (
                <span
                  key={s.name}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/60 px-2.5 py-1 text-xs"
                >
                  {s.name}
                  <span className="font-medium tabular-nums">{s.count}</span>
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Recent activity */}
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-sm">
        <h3 className="font-display text-lg font-semibold tracking-tight mb-4">
          Recent activity
        </h3>
        <ul className="divide-y divide-border">
          {data.recent.map((r) => (
            <li key={r.id} className="py-3 first:pt-0 last:pb-0 flex items-start gap-3">
              <SentimentBadge label={r.label as "POSITIVE" | "NEGATIVE" | "NEUTRAL"} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-relaxed text-foreground/90 line-clamp-2">
                  {r.text}
                </p>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{relativeTime(r.createdAt)}</span>
                  <span className="h-3 w-px bg-border" />
                  <span className="uppercase tracking-wider">
                    {SOURCE_LABELS[r.source] ?? r.source}
                  </span>
                  <span className="h-3 w-px bg-border" />
                  <span className="tabular-nums">
                    {(r.score * 100).toFixed(1)}% conf
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  sub,
  trend,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  trend?: number;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--clay)]/10 text-[var(--clay)]">
          {icon}
        </span>
        {trend !== undefined && trend > 0 && (
          <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--positive)]">
            ▲ rising
          </span>
        )}
      </div>
      <div className="font-display text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">
        {label}
      </div>
      <div className="text-xs text-muted-foreground mt-1">{sub}</div>
    </div>
  );
}

function avgConfidence(data: StatsData): number {
  // Use the recent sample as a proxy if no full avg available
  if (data.recent.length === 0) return 0;
  const sum = data.recent.reduce((acc, r) => acc + r.score, 0);
  return (sum / data.recent.length) * 100;
}
