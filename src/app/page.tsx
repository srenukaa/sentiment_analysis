"use client";

import { useState } from "react";
import { Header } from "@/components/site-header";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { LiveTicker } from "@/components/live-ticker";
import { SiteFooter } from "@/components/site-footer";
import { LiveAnalyzerView } from "@/components/views/live-analyzer-view";
import { PulseStreamView } from "@/components/views/pulse-stream-view";
import { AnalyticsView } from "@/components/views/analytics-view";
import { HistoryView } from "@/components/views/history-view";

type ViewId = "analyze" | "pulse" | "analytics" | "history";

const HEADERS: Record<ViewId, { eyebrow: string; title: string; subtitle: string }> = {
  analyze: {
    eyebrow: "Live Analyzer",
    title: "Type. Watch the model think.",
    subtitle:
      "A real-time sentiment engine running entirely in your browser via a quantized DistilBERT model from Hugging Face. Every keystroke triggers a fresh inference — no servers, no API keys, no data leaving your device.",
  },
  pulse: {
    eyebrow: "Pulse Stream",
    title: "Watch opinions arrive, one at a time.",
    subtitle:
      "A live feed of real customer comments pulled from public discussion communities via our server-side proxy. Each incoming message is classified the instant it lands — exactly how a production sentiment monitor would work.",
  },
  analytics: {
    eyebrow: "Analytics",
    title: "What the aggregate is telling you.",
    subtitle:
      "Daily trends, distribution by sentiment label, and volume by channel. The dashboard refreshes from your local SQLite database every time you open it.",
  },
  history: {
    eyebrow: "History",
    title: "Every verdict, searchable.",
    subtitle:
      "A full log of every text you have analyzed. Search by keyword, filter by label or source, and clear it all when you are done.",
  },
};

export default function Home() {
  const [view, setView] = useState<ViewId>("analyze");
  const h = HEADERS[view];

  return (
    <div className="min-h-screen flex flex-col">
      <Header active={view} onNavigate={(id) => setView(id as ViewId)} />

      <LiveTicker />

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 pb-24 md:pb-8">
        {/* Page header */}
        <div className="mb-6 sm:mb-8">
          <div className="eyebrow text-clay mb-2">{h.eyebrow}</div>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight leading-[1.05] mb-2">
            {h.title}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl leading-relaxed">
            {h.subtitle}
          </p>
        </div>

        {/* View */}
        {view === "analyze" && <LiveAnalyzerView />}
        {view === "pulse" && <PulseStreamView />}
        {view === "analytics" && <AnalyticsView />}
        {view === "history" && <HistoryView />}
      </main>

      <SiteFooter />
      <MobileTabBar active={view} onNavigate={(id) => setView(id as ViewId)} />
    </div>
  );
}
