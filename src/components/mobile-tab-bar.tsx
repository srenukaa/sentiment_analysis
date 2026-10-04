"use client";

import { PenLine, Radio, BarChart3, History, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  active: string;
  onNavigate: (id: string) => void;
}

const TABS = [
  { id: "analyze", label: "Analyze", icon: PenLine },
  { id: "pulse", label: "Pulse", icon: Radio },
  { id: "batch", label: "Upload", icon: Upload },
  { id: "analytics", label: "Stats", icon: BarChart3 },
  { id: "history", label: "History", icon: History },
];

/**
 * Mobile bottom tab bar — large 44px+ touch targets,
 * respects iOS safe-area inset. Now supports 5 tabs.
 */
export function MobileTabBar({ active, onNavigate }: Props) {
  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur-lg"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onNavigate(t.id)}
              className="flex flex-col items-center justify-center gap-0.5 py-2 min-h-[56px] relative"
              aria-current={isActive ? "page" : undefined}
            >
              {isActive && (
                <span className="absolute top-0 h-0.5 w-6 rounded-full bg-clay" />
              )}
              <Icon
                className={cn(
                  "h-[18px] w-[18px] transition-colors",
                  isActive ? "text-clay" : "text-muted-foreground"
                )}
                strokeWidth={isActive ? 2.4 : 2}
              />
              <span
                className={cn(
                  "text-[9px] font-medium uppercase tracking-wider transition-colors",
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
