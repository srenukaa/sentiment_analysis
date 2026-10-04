"use client";

import { PenLine, Radio, BarChart3, History } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  active: string;
  onNavigate: (id: string) => void;
}

const TABS = [
  { id: "analyze", label: "Analyze", icon: PenLine },
  { id: "pulse", label: "Pulse", icon: Radio },
  { id: "analytics", label: "Stats", icon: BarChart3 },
  { id: "history", label: "History", icon: History },
];

/**
 * Mobile bottom tab bar — large 44px+ touch targets,
 * respects iOS safe-area inset.
 */
export function MobileTabBar({ active, onNavigate }: Props) {
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur-lg"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-4">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onNavigate(t.id)}
              className="flex flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] relative"
              aria-current={isActive ? "page" : undefined}
            >
              {isActive && (
                <span className="absolute top-0 h-0.5 w-8 rounded-full bg-[var(--clay)]" />
              )}
              <Icon
                className={cn(
                  "h-5 w-5 transition-colors",
                  isActive ? "text-[var(--clay)]" : "text-muted-foreground"
                )}
                strokeWidth={isActive ? 2.4 : 2}
              />
              <span
                className={cn(
                  "text-[10px] font-medium uppercase tracking-wider transition-colors",
                  isActive ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
