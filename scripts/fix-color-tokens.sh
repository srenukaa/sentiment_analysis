#!/usr/bin/env bash
# Fix: replace arbitrary CSS-var color classes with Tailwind theme tokens.
# Tailwind 4 doesn't generate rules for bg-[var(--clay)] reliably,
# but does for bg-clay (because we declared --color-clay in @theme inline).

set -e
cd /home/z/my-project/src

# Tokens we mapped in @theme inline: clay, positive, negative, neutral-sent, saffron, moss, ink, canvas
TOKENS=("clay" "positive" "negative" "neutral-sent" "saffron" "moss" "ink" "canvas")

for T in "${TOKENS[@]}"; do
  # Property prefixes (bg, text, border, fill, stroke, ring, outline, etc.)
  for P in bg text border fill stroke ring outline decoration accent; do
    # plain arbitrary value: e.g. bg-[var(--clay)] -> bg-clay
    find app components hooks lib -type f \( -name "*.tsx" -o -name "*.ts" -o -name "*.css" \) -exec sed -i "s|${P}-\[var(--${T})\]|${P}-${T}|g" {} +
    # with /opacity modifier: e.g. bg-[var(--clay)]/10 -> bg-clay/10
    find app components hooks lib -type f \( -name "*.tsx" -o -name "*.ts" -o -name "*.css" \) -exec sed -i "s|${P}-\[var(--${T})\]/|${P}-${T}/|g" {} +
  done
done

echo "Done replacing arbitrary CSS-var color classes with Tailwind theme tokens."
