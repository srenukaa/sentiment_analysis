import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/webhook/reddit-feed?channel=<id>
 *
 * Server-side proxy that performs BRAND-KEYWORD TARGETED post search
 * across relevant subreddits and returns the FULL THREAD (post body +
 * top comments) for each matching post.
 *
 * Two-tier sentiment analysis happens in the FRONTEND (the HF model
 * runs in the browser). This endpoint only fetches & cleans the data:
 *
 *   1. Search the channel's subreddit for posts mentioning the channel's
 *      brand keywords (e.g. r/television for "netflix OR prime video").
 *   2. For each matching post, fetch its top-N comments thread.
 *   3. Return a list of ThreadPost objects, each containing:
 *        - post metadata (title, body, author, permalink, score, brand)
 *        - comments[] array (text, author, permalink, score)
 *
 * Channel → subreddit + brand keywords mapping:
 *
 *   E-Commerce Reviews  →  r/india          →  "amazon", "flipkart"
 *   Food Delivery       →  r/india          →  "zomato", "swiggy"
 *   Streaming Feedback  →  r/television     →  "netflix", "prime video"
 *   Support Tickets     →  r/techsupport     →  "error", "bug", "crash", "fix"
 *
 * Rate-limit strategy:
 *   Reddit's RSS endpoint allows ~1 request per 30s per IP. To stay
 *   under the limit we:
 *     - Cache each channel's full result set for 10 minutes
 *     - When the cache is stale, return the current cache and kick off
 *       a non-blocking background refresh (so the UI never waits)
 *     - Skip channels whose cache is still being refreshed (fetching=true)
 *
 * This means the first request after server boot returns an empty list
 * and starts the background fetch; subsequent requests (within ~30s)
 * return the populated cache.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { XMLParser } from "fast-xml-parser";
import { CHANNELS, detectBrand, type ChannelDef } from "@/lib/channels";

interface CommentItem {
  id: string;
  text: string;
  author: string;
  authorProfileUrl: string;
  permalink: string;
  score: number;
  createdUtc: number;
}

export interface ThreadPost {
  id: string;
  // Post metadata
  postTitle: string;
  postBody: string; // selftext or link description
  postAuthor: string;
  postAuthorProfileUrl: string;
  postPermalink: string;
  postCreatedUtc: number;
  postScore: number;
  subreddit: string;
  // Classification
  channel: string;
  channelLabel: string;
  brand: {
    key: string;
    displayName: string;
  };
  // Comments thread
  comments: CommentItem[];
}

interface CacheEntry {
  posts: ThreadPost[];
  fetchedAt: number;
  fetching: boolean;
  lastError: string | null;
}

const channelCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
// Fetch 3 posts per channel. The search is 1 Reddit request; comment
// fetches are best-effort (they usually 429 because the search consumed
// the rate-limit window, but we try anyway and gracefully degrade).
const POSTS_PER_CHANNEL = 3;
const COMMENTS_PER_POST = 5;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  isArray: (name) => name === "entry",
});

/** Strip HTML tags + decode entities from RSS `<content>` blocks. */
function extractCleanText(htmlContent: string): string {
  if (!htmlContent) return "";
  let t = htmlContent;
  t = t.replace(/<!--[\s\S]*?-->/g, "");
  t = t
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#32;/g, " "); // numeric space entity used by Reddit
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > 500) t = t.slice(0, 500).trim() + "…";
  return t;
}

/**
 * Reddit RSS search-result entries have a `<content>` block that bundles
 * the post selftext + a "submitted by ..." footer. We want to extract
 * just the selftext (the part before "submitted by").
 */
function extractPostBody(htmlContent: string): string {
  if (!htmlContent) return "";
  let t = htmlContent;
  t = t.replace(/<!--[\s\S]*?-->/g, "");
  // Cut off at the "submitted by" marker that Reddit appends to search results
  const cutIdx = t.indexOf("submitted by");
  if (cutIdx > 0) t = t.slice(0, cutIdx);
  t = t
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#32;/g, " ");
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > 1000) t = t.slice(0, 1000).trim() + "…";
  return t;
}

interface ParsedEntry {
  author?: { name?: string; uri?: string };
  content?: string | { "#text"?: string; type?: string };
  id?: string;
  link?: string | Array<{ href?: string }> | { href?: string };
  updated?: string;
  published?: string;
  title?: string;
  category?: string | Array<{ term?: string; label?: string }>;
}

function getEntryContent(entry: ParsedEntry): string {
  if (typeof entry.content === "string") return entry.content;
  if (entry.content && typeof entry.content === "object" && "#text" in entry.content) {
    return String(entry.content["#text"] ?? "");
  }
  return "";
}

function getEntryLink(entry: ParsedEntry): string {
  if (typeof entry.link === "string") return entry.link;
  if (Array.isArray(entry.link) && entry.link[0]?.href) return entry.link[0].href;
  if (entry.link && typeof entry.link === "object" && "href" in entry.link) {
    return entry.link.href ?? "";
  }
  return "";
}

/** Extract post ID from a Reddit permalink (e.g. .../comments/1wx0wfa/title/ → 1wx0wfa) */
function extractPostId(permalink: string): string | null {
  const m = permalink.match(/\/comments\/([A-Za-z0-9]+)\//);
  return m ? m[1] : null;
}

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  return fetch(url, {
    headers: {
      "User-Agent": "Sentira/1.0 (sentiment-analysis-fyp by /u/sentira_fyp)",
      Accept: "application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Search a subreddit for posts matching the channel's brand keywords. */
async function searchPosts(
  cfg: ChannelDef
): Promise<{ entries: ParsedEntry[]; error: string | null }> {
  // Build the search query: "amazon OR flipkart"
  const query = cfg.brands.map((b) => `"${b}"`).join(" OR ");
  const url = `https://www.reddit.com/r/${cfg.subreddit}/search.rss?q=${encodeURIComponent(
    query
  )}&restrict_sr=1&sort=relevance&limit=${POSTS_PER_CHANNEL}`;

  try {
    const res = await fetchWithTimeout(url);
    if (res.status === 429) return { entries: [], error: "rate-limited by Reddit" };
    if (!res.ok) return { entries: [], error: `HTTP ${res.status}` };
    const xml = await res.text();
    const parsed = parser.parse(xml) as { feed?: { entry?: ParsedEntry[] } };
    return { entries: parsed?.feed?.entry ?? [], error: null };
  } catch (err) {
    return { entries: [], error: err instanceof Error ? err.message : "search failed" };
  }
}

/** Fetch the top-N comments for a specific post. */
async function fetchPostComments(
  subreddit: string,
  postId: string,
  limit: number
): Promise<{ comments: CommentItem[]; error: string | null }> {
  const url = `https://www.reddit.com/r/${subreddit}/comments/${postId}/.rss?limit=${limit}&sort=top`;
  try {
    const res = await fetchWithTimeout(url);
    if (res.status === 429) return { comments: [], error: "rate-limited" };
    if (!res.ok) return { comments: [], error: `HTTP ${res.status}` };
    const xml = await res.text();
    const parsed = parser.parse(xml) as { feed?: { entry?: ParsedEntry[] } };
    const entries = parsed?.feed?.entry ?? [];

    const comments: CommentItem[] = [];
    for (const entry of entries) {
      const rawContent = getEntryContent(entry);
      const text = extractCleanText(rawContent);
      if (text.length < 4) continue;
      const permalink = getEntryLink(entry);
      if (!permalink) continue;
      const authorName = entry.author?.name ?? "[deleted]";
      comments.push({
        id: entry.id ?? `c-${postId}-${Math.random().toString(36).slice(2)}`,
        text,
        author: authorName.startsWith("/u/") ? authorName.slice(3) : authorName,
        authorProfileUrl: entry.author?.uri ?? "",
        permalink,
        score: 0,
        createdUtc: entry.updated
          ? Math.floor(Date.parse(entry.updated) / 1000)
          : Math.floor(Date.now() / 1000),
      });
    }
    return { comments, error: null };
  } catch (err) {
    return { comments: [], error: err instanceof Error ? err.message : "comments fetch failed" };
  }
}

/** Fetch a full channel's worth of thread posts (search + per-post comments). */
async function fetchChannel(channelId: string, cfg: ChannelDef): Promise<{
  posts: ThreadPost[];
  error: string | null;
}> {
  // Step 1: search for posts matching the brand keywords
  const { entries, error: searchError } = await searchPosts(cfg);
  if (searchError) return { posts: [], error: searchError };
  if (entries.length === 0) return { posts: [], error: "no matching posts found" };

  // Step 2: build ThreadPost objects (without comments yet)
  const partialPosts: Array<{
    post: Omit<ThreadPost, "comments">;
    postId: string;
  }> = [];

  for (const entry of entries) {
    const rawContent = getEntryContent(entry);
    let postBody = extractPostBody(rawContent);
    const postPermalink = getEntryLink(entry);
    if (!postPermalink) continue;
    const postId = extractPostId(postPermalink);
    if (!postId) continue;

    const postTitle = entry.title ?? "(untitled post)";
    // Link posts (no selftext) have empty body — fall back to the title
    // so the sentiment model has something to analyze.
    if (!postBody || postBody.length < 4) {
      postBody = postTitle;
    }
    const authorName = entry.author?.name ?? "[deleted]";
    const brand = detectBrand(
      `${postTitle} ${postBody}`,
      cfg.brands,
      cfg.brandDisplayNames
    );

    partialPosts.push({
      post: {
        id: postId,
        postTitle,
        postBody,
        postAuthor: authorName.startsWith("/u/") ? authorName.slice(3) : authorName,
        postAuthorProfileUrl: entry.author?.uri ?? "",
        postPermalink,
        postCreatedUtc: entry.updated
          ? Math.floor(Date.parse(entry.updated) / 1000)
          : Math.floor(Date.now() / 1000),
        postScore: 0,
        subreddit: cfg.subreddit,
        channel: channelId,
        channelLabel: cfg.label,
        brand,
      },
      postId,
    });
  }

  // Step 3: fetch comments for each post. We try immediately after the
  // search — if Reddit rate-limits us (very likely, since the search
  // consumed the current window), we gracefully degrade and the post
  // body alone is used for postSentiment. The UI shows "comments
  // unavailable" when comments.length === 0.
  //
  // A background retry happens on the next cache refresh (10 min later).
  const posts: ThreadPost[] = [];
  for (let i = 0; i < partialPosts.length; i++) {
    const { post, postId } = partialPosts[i];
    const { comments, error: commentsError } = await fetchPostComments(
      cfg.subreddit,
      postId,
      COMMENTS_PER_POST
    );
    posts.push({ ...post, comments });

    if (commentsError) {
      console.warn(`[reddit-feed] comments fetch failed for ${postId}: ${commentsError}`);
    }

    // Don't propagate comment errors as channel-level errors — we still
    // have the post body and can run sentiment on it alone.
    if (commentsError) {
      console.warn(`[reddit-feed] comments fetch failed for ${postId}: ${commentsError}`);
    }
  }

  return { posts, error: null };
}

/** Refresh a single channel's cache in the background. */
async function refreshChannelCache(channelId: string, cfg: ChannelDef) {
  const existing = channelCache.get(channelId);
  channelCache.set(channelId, {
    posts: existing?.posts ?? [],
    fetchedAt: existing?.fetchedAt ?? 0,
    fetching: true,
    lastError: existing?.lastError ?? null,
  });

  const { posts, error } = await fetchChannel(channelId, cfg);
  channelCache.set(channelId, {
    posts,
    fetchedAt: Date.now(),
    fetching: false,
    lastError: error,
  });
}

/**
 * Global refresh lock — only ONE channel refresh runs at a time.
 * Reddit's RSS rate limit is ~1 req per 5-30s per IP, so parallel
 * refreshes would all 429. This queue ensures each refresh completes
 * (or fails) before the next one starts.
 *
 * The queue also inserts a stagger between refreshes to give Reddit's
 * rate-limit window time to reset.
 */
let refreshQueue: Promise<void> = Promise.resolve();
const REFRESH_STAGGER_MS = 45000; // 45s between channels — Reddit allows ~1 req per 43s window
function enqueueRefresh(channelId: string, cfg: ChannelDef): Promise<void> {
  const run = refreshQueue
    .then(async () => {
      await refreshChannelCache(channelId, cfg);
      await new Promise((r) => setTimeout(r, REFRESH_STAGGER_MS));
    })
    .catch(() => {});
  refreshQueue = run;
  return run;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const channel = searchParams.get("channel") ?? "all";
  const forceRefresh = searchParams.get("force") === "1";

  const targets =
    channel === "all" || !CHANNELS.find((c) => c.id === channel)
      ? CHANNELS
      : CHANNELS.filter((c) => c.id === channel);

  // For each target channel:
  // 1. If cache is fresh → use it
  // 2. If cache is stale and not currently fetching → kick off background refresh
  // 3. Return whatever's in the cache (could be stale, could be empty)
  const allPosts: ThreadPost[] = [];
  const errors: { channel: string; error: string }[] = [];
  let fetchedAt: number | null = null;
  let stillWarming = false;

  for (const cfg of targets) {
    const cached = channelCache.get(cfg.id);

    if (forceRefresh && cached) {
      // Force a refresh
      channelCache.delete(cfg.id);
    }

    const now = Date.now();
    const current = channelCache.get(cfg.id);
    const isStale = !current || now - current.fetchedAt > CACHE_TTL_MS;

    if (isStale && (!current || !current.fetching)) {
      // Queue a background refresh (serialized to respect Reddit's rate limit)
      void enqueueRefresh(cfg.id, cfg);
      if (!current || current.posts.length === 0) stillWarming = true;
    }

    if (current) {
      allPosts.push(...current.posts);
      if (current.lastError) {
        errors.push({ channel: cfg.label, error: current.lastError });
      }
      if (!fetchedAt || current.fetchedAt > fetchedAt) {
        fetchedAt = current.fetchedAt;
      }
    } else {
      stillWarming = true;
    }
  }

  // Sort by post recency (newest first)
  allPosts.sort((a, b) => b.postCreatedUtc - a.postCreatedUtc);

  if (allPosts.length === 0) {
    return NextResponse.json({
      ok: true,
      posts: [],
      errors,
      fetchedAt: fetchedAt ?? Date.now(),
      cached: false,
      warming: stillWarming,
      message: stillWarming
        ? "Fetching brand-keyword posts from Reddit in the background. This takes ~30s due to Reddit's rate limit. Refresh in a moment."
        : "No posts matched the brand keywords yet.",
    });
  }

  return NextResponse.json({
    ok: true,
    posts: allPosts,
    errors,
    fetchedAt: fetchedAt ?? Date.now(),
    cached: !forceRefresh,
    warming: stillWarming,
  });
}
