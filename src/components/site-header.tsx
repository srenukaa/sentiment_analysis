"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { Moon, Sun, Github, Activity } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  active: string;
  onNavigate: (id: string) => void;
}

const NAV = [
  { id: "analyze", label: "Live Analyzer" },
  { id: "pulse", label: "Pulse Stream" },
  { id: "analytics", label: "Analytics" },
  { id: "history", label: "History" },
];

export function Header({ active, onNavigate }: Props) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2.5 group"
          onClick={(e) => {
            e.preventDefault();
            onNavigate("analyze");
          }}
        >
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--clay)] text-[var(--background)] shadow-sm transition-transform group-hover:scale-105">
            <Activity className="h-4 w-4" strokeWidth={2.5} />
          </span>
          <div className="flex flex-col leading-none">
            <span className="font-display text-lg font-semibold tracking-tight">Sentira</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Sentiment Intelligence
            </span>
          </div>
        </Link>

        {/* Center nav (desktop only) */}
        <nav className="hidden md:flex items-center gap-1">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => onNavigate(n.id)}
              className={cn(
                "relative rounded-md px-3.5 py-2 text-sm font-medium transition-colors",
                active === n.id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {n.label}
              {active === n.id && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--clay)]" />
              )}
            </button>
          ))}
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-1">
          <a
            href="https://huggingface.co/Xenova/distilbert-base-uncased-finetuned-sst-2-english"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:inline-flex"
            title="Model card on Hugging Face"
          >
            <Button variant="ghost" size="icon" className="h-9 w-9">
              <Github className="h-4 w-4" />
            </Button>
          </a>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
          >
            {mounted && theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </header>
  );
}
