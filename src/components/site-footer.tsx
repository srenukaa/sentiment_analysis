"use client";

import { Heart } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-[var(--canvas)]/40">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="space-y-1">
            <div className="font-display text-base font-semibold tracking-tight">
              Sentira
            </div>
            <p className="text-xs text-muted-foreground max-w-md leading-relaxed">
              Final-year project · Real-time sentiment analysis powered by Hugging Face
              Transformers.js. Built with Next.js, Prisma, and Tailwind.
            </p>
          </div>
          <div className="flex flex-col sm:items-end gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <a
                href="https://huggingface.co/Xenova/distilbert-base-uncased-finetuned-sst-2-english"
                target="_blank"
                rel="noreferrer"
                className="link-dotted hover:text-foreground transition-colors"
              >
                Model card
              </a>
              <a
                href="https://github.com/huggingface/transformers.js"
                target="_blank"
                rel="noreferrer"
                className="link-dotted hover:text-foreground transition-colors"
              >
                Transformers.js
              </a>
            </div>
            <div className="flex items-center gap-1.5">
              <span>Crafted with</span>
              <Heart className="h-3 w-3 fill-[var(--clay)] text-[var(--clay)]" />
              <span>for the final-year demo</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
