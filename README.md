# Sentira — Real-time Sentiment Intelligence

A real-time sentiment analysis web app built for the final-year project.
Runs a small Hugging Face model **entirely in the browser** (no API key, no server inference),
with a mobile-first UI designed to look hand-crafted, not AI-generated.

---

## What this project is

Sentira is a single-page web application that classifies any text as
**Positive**, **Negative**, or **Neutral** in real time, using a
quantized DistilBERT model from Hugging Face running locally in your
browser via Transformers.js.

It is not a toy demo. It is structured like a production sentiment-monitoring
product, with four working views:

| View | What it does |
|------|--------------|
| **Live Analyzer** | Type or paste any text. The model classifies it as you type (350 ms debounce). Shows confidence distribution across all three classes. |
| **Pulse Stream** | A simulated real-time feed of customer feedback across four verticals (e-commerce, food delivery, streaming, support). Each incoming message is classified on arrival. |
| **Analytics** | KPIs, a 7-day trend chart, label distribution donut, and channel volume bars — all driven by your local SQLite database. |
| **History** | Every analysis you run is persisted. Full-text search, filter by source / label, and one-click clear-all. |

### Real-time use case

The Pulse Stream view simulates a real customer-feedback pipeline:
messages arrive at a configurable cadence (Slow / Normal / Fast),
get classified the instant they land, and roll up into the analytics
dashboard. This is the exact pattern used by social listening tools
(Brandwatch, Sprinklr) and customer-experience platforms (Zendesk,
Qualtrics) — except here the inference runs on-device.

---

## Tech stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 16 (App Router) + TypeScript | Modern, production-grade, mobile-friendly out of the box |
| UI | Tailwind CSS 4 + shadcn/ui + Framer Motion | Custom design system on top of accessible primitives |
| Fonts | Fraunces (serif display) + Inter (sans body) + JetBrains Mono (eyebrows) | Editorial pairing — avoids the AI-template look |
| Inference | `@huggingface/transformers` running `Xenova/distilbert-base-uncased-finetuned-sst-2-english` (~66 MB quantized, runs in WASM) | Small, fast, no API key, works offline after first load |
| Database | Prisma ORM + SQLite | Zero-config local persistence — perfect for a demo |
| Charts | Recharts | Responsive SVG charts that work on touch screens |
| State | React hooks + TanStack-style fetch wrappers | No global state library needed for this scope |

---

## File structure

```
sentira/
├── prisma/
│   └── schema.prisma              # Analysis + DailyStat models
├── src/
│   ├── app/
│   │   ├── layout.tsx             # Root layout (fonts, theme, toasters)
│   │   ├── page.tsx               # Main page — switches between views
│   │   ├── globals.css            # Editorial-warm design system
│   │   └── api/
│   │       ├── analyses/route.ts  # POST/GET/DELETE history
│   │       └── stats/route.ts     # Aggregated analytics
│   ├── components/
│   │   ├── site-header.tsx        # Top nav (desktop)
│   │   ├── mobile-tab-bar.tsx     # Bottom tab bar (mobile, 56px touch targets)
│   │   ├── live-ticker.tsx        # Top marquee strip
│   │   ├── site-footer.tsx
│   │   ├── sentiment-badge.tsx
│   │   ├── confidence-gauge.tsx
│   │   ├── model-status-pill.tsx
│   │   ├── theme-provider.tsx
│   │   └── views/
│   │       ├── live-analyzer-view.tsx
│   │       ├── pulse-stream-view.tsx
│   │       ├── analytics-view.tsx
│   │       └── history-view.tsx
│   ├── hooks/
│   │   └── use-sentiment-engine.ts # Central HF model loader + analyzer
│   └── lib/
│       ├── sentiment.ts           # Transformers.js wrapper
│       ├── channels.ts            # Pulse stream sample data
│       ├── db.ts                   # Prisma client
│       └── utils.ts
└── package.json
```

---

## Running on a laptop / desktop

### Prerequisites
- **Node.js 18+** (Node 20 LTS recommended)
- **npm** or **bun** (bun is faster — recommended)

### Step-by-step

1. **Install dependencies**
   ```bash
   npm install
   # or, faster:
   bun install
   ```

2. **Set up the database**
   Create a `.env` file at the project root with:
   ```
   DATABASE_URL="file:./db/custom.db"
   ```
   Then push the schema:
   ```bash
   npm run db:push
   # or: bun run db:push
   ```
   This creates a SQLite database file at `db/custom.db`. No external DB to install.

3. **Start the dev server**
   ```bash
   npm run dev
   # or: bun run dev
   ```
   You will see something like:
   ```
   ▲ Next.js 16.1.1
   - Local:   http://localhost:3000
   ```

4. **Open in your browser**
   Visit **http://localhost:3000** in Chrome, Firefox, Edge, or Safari.

5. **First-time model load**
   The first time you open the app, the browser will download the
   quantized DistilBERT model (~66 MB) from the Hugging Face CDN.
   You will see a "Loading model · X%" pill in the top-right of the
   Live Analyzer view. Once it hits 100%, the model is cached by the
   browser — subsequent loads are instant.

6. **Try it**
   - Type into the analyzer textarea — verdict updates as you type.
   - Click "Pulse Stream" → "Start stream" — watch messages arrive.
   - Open "Analytics" — see your aggregate stats.
   - Open "History" — search past analyses.

### Production build (optional, for the demo day)
```bash
npm run build
npm run start
```
Then visit `http://localhost:3000`.

---

## Running on a phone (same network as the laptop)

Phones cannot run Next.js dev servers on their own, so we will
**serve the app from your laptop and access it from your phone over Wi-Fi**.

### Step 1 — Find your laptop's local IP

- **macOS**: System Settings → Wi-Fi → click your network → "IP Address"
  (usually `192.168.x.x` or `10.0.x.x`)
- **Windows**: Settings → Network → Properties → IPv4 address
- **Linux**: `ip addr show | grep inet` (look for `192.168.x.x`)

### Step 2 — Start the dev server bound to all interfaces

The default `npm run dev` only listens on `localhost`. To expose it to
your phone, run:

```bash
# Replace 3000 with any free port if needed
npx next dev -H 0.0.0.0 -p 3000
```

Or, if you are using bun:
```bash
bun x next dev -H 0.0.0.0 -p 3000
```

You should see output like:
```
- Local:    http://localhost:3000
- Network:  http://192.168.1.42:3000   ← use this URL
```

### Step 3 — Make sure both devices are on the same Wi-Fi

This will not work if your laptop is on Ethernet and your phone is on
mobile data. Connect both to the same network.

### Step 4 — Open on your phone

On your phone's browser (Chrome on Android, Safari on iOS), visit:

```
http://192.168.1.42:3000
```

(replace with the IP from step 1)

The mobile UI is fully optimized:
- Bottom tab bar with 56px touch targets (exceeds Apple's 44px minimum)
- Respects iOS safe-area insets
- Layout reflows from 2-column desktop to single-column mobile
- No horizontal scroll
- Charts resize responsively

### Step 5 (optional) — Pin to home screen

- **iOS Safari**: tap the Share icon → "Add to Home Screen"
- **Android Chrome**: tap the three-dot menu → "Add to Home screen"

This gives you an icon that opens Sentira full-screen, like a native app.

---

## Troubleshooting

### "Module not found: Can't resolve '@/huggingface/transformers'"
Run `npm install` (or `bun install`) again. The dependency is in `package.json`.

### Model never loads (stuck on "Loading model · 0%")
The model download requires an internet connection on first load.
Check that `huggingface.co` is reachable from your network. Once
downloaded, it is cached and works offline.

### The Pulse Stream view shows nothing
Press the **Start stream** button at the top right. The feed does not
auto-start — it waits for you so you can pick a channel and speed first.

### Database is empty after a restart
The database lives at `db/custom.db`. If you delete it, run
`npm run db:push` again to recreate the schema.

### Port 3000 is already in use
```bash
npx next dev -H 0.0.0.0 -p 3001
```
Then visit `http://localhost:3001` (or `http://192.168.1.42:3001` on your phone).

### Phone cannot reach laptop
1. Confirm both devices are on the same Wi-Fi network.
2. Confirm your laptop's firewall allows incoming connections on port 3000.
3. Some public Wi-Fi networks block device-to-device traffic — use a
   phone hotspot or a home network instead.

---

## Architecture notes (good to mention in your viva)

- **Why in-browser inference?** Privacy (no data leaves the device),
  low latency (no network round-trip per inference), and zero infra cost
  (no GPU server to maintain). The trade-off is the ~66 MB initial model
  download, mitigated by browser caching.
- **Why a singleton model loader?** Transformers.js pipelines are
  expensive to construct. `loadModel()` caches the pipeline in a module-
  level variable and shares it across all views via the
  `useSentimentEngine` hook.
- **Why SQLite?** The app needs persistence (history, daily stats) but
  no concurrency. SQLite is a single file, ships with zero setup, and
  survives restarts. For a production deployment you would swap to
  Postgres by changing one line in `prisma/schema.prisma`.
- **Why simulated pulse instead of real Twitter API?** Twitter/X API
  access requires paid developer credentials and has heavy rate limits.
  The simulation lets you demo the full real-time UX without those
  dependencies. To plug in a real feed, replace the `tick()` function
  in `pulse-stream-view.tsx` with a WebSocket subscription.

---

## What to demo in your final-year presentation

1. **Live Analyzer** — type a positive sentence, then a negative one,
   then a neutral one. Show the confidence gauge updating in real time.
2. **Pulse Stream** — start it on "Fast" speed. Let it run for 30
   seconds. The live counter and feed should fill up.
3. **Analytics** — show the trend chart, distribution donut, and channel
   breakdown. Mention these all come from your local SQLite.
4. **History** — search for a keyword like "delivery" to show the
   filter works.
5. **Mobile** — open the same URL on your phone (or use Chrome dev
   tools' device toolbar). Show the bottom tab bar and responsive layout.
6. **Dark mode** — click the moon icon in the top-right. Show the warm
   sepia dark theme (not the typical AI blue).

---

## License & credits

- Model: [`Xenova/distilbert-base-uncased-finetuned-sst-2-english`](https://huggingface.co/Xenova/distilbert-base-uncased-finetuned-sst-2-english)
  by Hugging Face, based on DistilBERT (Sanh et al., 2019).
- Inference runtime: [Transformers.js](https://github.com/huggingface/transformers.js)
- Built with Next.js, Prisma, Tailwind CSS, shadcn/ui, Recharts, Framer Motion.
