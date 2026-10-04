import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/webhook/reddit-feed?channel=<id>
 *
 * Server-side proxy that fetches LIVE, AUTHENTIC Reddit comments via
 * Reddit's public RSS feeds (which still work without OAuth, unlike
 * the deprecated .json endpoint that now returns 403).
 *
 * Why RSS instead of .json?
 *   - Reddit deprecated anonymous .json access in 2023 → HTTP 403.
 *   - RSS feeds (`.rss`) are still publicly available and contain
 *     everything we need: comment text, author, post title, the
 *     comment's permalink, timestamp, and subreddit.
 *
 * Channel → subreddit mapping (each focuses on authentic customer
 * feedback for its vertical):
 *
 *   E-Commerce Reviews   →  r/BuyItForLife    (durable-product reviews)
 *   Food Delivery        →  r/doordash         (driver & order feedback)
 *   Streaming Feedback   →  r/television       (viewer reactions to shows)
 *   Support Tickets      →  r/techsupport      (real troubleshooting threads)
 *
 * Rate-limit strategy:
 *   Reddit's RSS endpoint allows only ~1 request per 30 seconds per IP
 *   (returns 429 with x-ratelimit-reset header otherwise).
 *   - We cache each subreddit's results independently for 5 minutes
 *     (Reddit's RSS only updates every ~60s anyway).
 *   - When the user requests "all" we fan out across subreddits but
 *     only fire requests for the ones whose cache has expired.
 *   - Subreddits that get 429'd are skipped silently; we surface
 *     friendly partial errors instead of failing the whole call.
 *   - This keeps the UI responsive — even if Reddit is throttling us,
 *     the queue keeps filling from whichever subreddits succeed.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { XMLParser } from "fast-xml-parser";

interface ChannelConfig {
  subreddit: string;
  label: string;
}

const CHANNEL_MAP: Record<string, ChannelConfig> = {
  ecommerce: { subreddit: "BuyItForLife", label: "E-Commerce Reviews" },
  "food-delivery": { subreddit: "doordash", label: "Food Delivery" },
  streaming: { subreddit: "television", label: "Streaming Feedback" },
  support: { subreddit: "techsupport", label: "Support Tickets" },
};

export interface RedditFeedItem {
  id: string;
  text: string;
  author: string;
  authorProfileUrl: string;
  channel: string;
  channelLabel: string;
  subreddit: string;
  /** Direct permalink to this exact comment on reddit.com */
  permalink: string;
  /** Title of the post this comment is replying to */
  postTitle: string;
  /** Permalink to the parent post */
  postPermalink: string;
  /** Seconds since epoch */
  timestamp: number;
  source: "reddit";
}

/** Per-subreddit cache entry. */
interface SubCache {
  items: RedditFeedItem[];
  fetchedAt: number;
  /** If true, last fetch hit a 429 — skip retrying until BACKOFF_MS elapses. */
  rateLimited: boolean;
  lastError: string | null;
}

const subCache = new Map<string, SubCache>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT_BACKOFF_MS = 60 * 1000; // 60s backoff after a 429

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  isArray: (name) => name === "entry",
});

/**
 * Reddit RSS wraps comment text in HTML like:
 *   <!-- SC_OFF --><div class="md"><p>Comment text</p> </div><!-- SC_ON -->
 * We strip all tags and decode HTML entities to get clean text.
 */
function extractCleanText(htmlContent: string): string {
  if (!htmlContent) return "";
  let t = htmlContent;
  // Strip HTML comments
  t = t.replace(/<!--[\s\S]*?-->/g, "");
  // Convert common HTML entities to their characters
  t = t
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
  // Remove all remaining HTML tags
  t = t.replace(/<[^>]+>/g, "");
  // Collapse whitespace
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > 500) t = t.slice(0, 500).trim() + "…";
  return t;
}

/**
 * Reddit RSS titles look like:
 *   "/u/EconomyDoctor3287 on I'm in my 3rd damaged Sonicare"
 * We extract the post title (everything after " on ").
 */
function extractPostTitle(rawTitle: string): string {
  if (!rawTitle) return "(untitled post)";
  const idx = rawTitle.indexOf(" on ");
  if (idx < 0) return rawTitle;
  return rawTitle.slice(idx + 4).trim() || "(untitled post)";
}

/**
 * Derive a permalink to the parent post from the comment permalink.
 * Comment permalinks look like:
 *   https://www.reddit.com/r/BuyItForLife/comments/1wx6l2z/im_in_my_3rd_damaged_sonicare/pdryg31/
 * The post permalink is the same URL up to and including the post slug,
 * without the trailing comment ID.
 */
function derivePostPermalink(commentPermalink: string): string {
  const m = commentPermalink.match(
    /^(https?:\/\/(?:www\.)?reddit\.com\/r\/[^/]+\/comments\/[^/]+\/[^/]+)\//
  );
  if (m) return m[1] + "/";
  try {
    const u = new URL(commentPermalink);
    const parts = u.pathname.split("/").filter(Boolean);
    parts.pop();
    return `${u.origin}/${parts.join("/")}/`;
  } catch {
    return commentPermalink;
  }
}

interface ParsedEntry {
  author?: { name?: string; uri?: string };
  content?: string;
  id?: string;
  link?: string | Array<{ href?: string }>;
  updated?: string;
  title?: string;
  category?: string | Array<{ term?: string; label?: string }>;
}

async function fetchRedditRss(cfg: ChannelConfig, channelId: string): Promise<{
  items: RedditFeedItem[];
  rateLimited: boolean;
  error: string | null;
}> {
  const url = `https://www.reddit.com/r/${cfg.subreddit}/comments/.rss?limit=10`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Sentira/1.0 (sentiment-analysis-fyp by /u/sentira_fyp)",
      Accept: "application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  if (res.status === 429) {
    return { items: [], rateLimited: true, error: "rate-limited by Reddit" };
  }
  if (!res.ok) {
    return { items: [], rateLimited: false, error: `HTTP ${res.status}` };
  }

  const xml = await res.text();
  const parsed = parser.parse(xml) as {
    feed?: { entry?: ParsedEntry[] };
  };

  const entries = parsed?.feed?.entry ?? [];
  const items: RedditFeedItem[] = [];

  for (const entry of entries) {
    if (!entry) continue;
    // Content can be a string OR an object with { #text, type } when the
    // type="html" attribute is present. Normalize to string.
    let rawContent = "";
    if (typeof entry.content === "string") {
      rawContent = entry.content;
    } else if (entry.content && typeof entry.content === "object" && "#text" in entry.content) {
      rawContent = String((entry.content as { "#text": string })["#text"]);
    }
    const text = extractCleanText(rawContent);
    if (text.length < 4) continue;

    let permalink = "";
    if (typeof entry.link === "string") {
      permalink = entry.link;
    } else if (Array.isArray(entry.link) && entry.link[0]?.href) {
      permalink = entry.link[0].href;
    } else if (entry.link && typeof entry.link === "object" && "href" in entry.link) {
      permalink = (entry.link as { href: string }).href;
    }
    if (!permalink) continue;

    const authorName = entry.author?.name ?? "[deleted]";
    const authorProfileUrl = entry.author?.uri ?? "";
    const postTitle = extractPostTitle(entry.title ?? "");
    const postPermalink = derivePostPermalink(permalink);
    const timestamp = entry.updated
      ? Math.floor(Date.parse(entry.updated) / 1000)
      : Math.floor(Date.now() / 1000);

    items.push({
      id: entry.id ?? `reddit-${cfg.subreddit}-${Math.random().toString(36).slice(2)}`,
      text,
      author: authorName.startsWith("/u/") ? authorName.slice(3) : authorName,
      authorProfileUrl,
      channel: channelId,
      channelLabel: cfg.label,
      subreddit: cfg.subreddit,
      permalink,
      postTitle,
      postPermalink,
      timestamp,
      source: "reddit",
    });
  }
  return { items, rateLimited: false, error: null };
}

/** Fetch a single subreddit, using the cache when fresh. */
async function fetchChannelCached(channelId: string, cfg: ChannelConfig): Promise<{
  items: RedditFeedItem[];
  error: string | null;
}> {
  const now = Date.now();
  const cached = subCache.get(cfg.subreddit);

  // Cache hit?
  if (cached) {
    const age = now - cached.fetchedAt;
    const ttl = cached.rateLimited ? RATE_LIMIT_BACKOFF_MS : CACHE_TTL_MS;
    if (age < ttl) {
      return { items: cached.items, error: cached.lastError };
    }
  }

  // Cache miss or stale — fetch fresh
  const result = await fetchRedditRss(cfg, channelId);
  subCache.set(cfg.subreddit, {
    items: result.items,
    fetchedAt: now,
    rateLimited: result.rateLimited,
    lastError: result.error,
  });
  return { items: result.items, error: result.error };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const channel = searchParams.get("channel") ?? "all";
  const forceRefresh = searchParams.get("force") === "1";

  // If force refresh, clear cache for the requested channel(s)
  if (forceRefresh) {
    if (channel === "all" || !CHANNEL_MAP[channel]) {
      subCache.clear();
    } else {
      subCache.delete(CHANNEL_MAP[channel].subreddit);
    }
  }

  const targets =
    channel === "all" || !CHANNEL_MAP[channel]
      ? Object.entries(CHANNEL_MAP)
      : [[channel, CHANNEL_MAP[channel]] as const];

  const allItems: RedditFeedItem[] = [];
  const errors: { channel: string; error: string }[] = [];
  let fetchedAt: number | null = null;

  // Fetch all targets in parallel — the per-subreddit cache will absorb
  // burst requests, so we don't actually hit Reddit more than once per
  // channel per CACHE_TTL_MS.
  await Promise.all(
    targets.map(async ([id, cfg]) => {
      const { items, error } = await fetchChannelCached(id, cfg);
      if (items.length > 0) {
        allItems.push(...items);
      }
      if (error) {
        errors.push({ channel: cfg.label, error });
      }
      const c = subCache.get(cfg.subreddit);
      if (c && (!fetchedAt || c.fetchedAt > fetchedAt)) {
        fetchedAt = c.fetchedAt;
      }
    })
  );

  // Sort by recency (newest first)
  allItems.sort((a, b) => b.timestamp - a.timestamp);

  if (allItems.length === 0 && errors.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        items: [],
        errors,
        message:
          "Reddit is rate-limiting requests right now. The proxy caches each subreddit for 5 minutes, so please wait ~30 seconds and try again — the feed will then fill up with real comments.",
      },
      { status: 200 }
    );
  }

  return NextResponse.json({
    ok: true,
    items: allItems,
    errors,
    fetchedAt: fetchedAt ?? Date.now(),
    cached: !forceRefresh,
  });
}
