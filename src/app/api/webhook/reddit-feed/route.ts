import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/webhook/reddit-feed?channel=<id>
 *
 * Server-side proxy that fetches live user comments from public JSON feeds.
 *
 * IMPORTANT — Reddit access change:
 * Reddit deprecated unauthenticated JSON access in 2023 and now returns
 * HTTP 403 for all /r/<sub>/comments.json requests without OAuth. To keep
 * the demo working without forcing the user to register Reddit app
 * credentials, we fall back to Lemmy — a federated Reddit-alternative
 * whose entire API is open JSON without authentication.
 *
 * Channel → community mapping (Lemmy communities that mirror the original
 * Reddit subreddits as closely as possible):
 *
 *   E-Commerce Reviews   →  c/BuyItForLife     (was r/BuyItForLife)
 *   Food Delivery        →  c/food              (was r/doordash)
 *   Streaming Feedback   →  c/movies            (was r/netflix)
 *   Support Tickets      →  c/techsupport       (was r/techsupport)
 *
 * If the user requests "all", we fan out one request per channel in parallel.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChannelConfig {
  lemmyCommunity: string;
  label: string;
  // Original subreddit name — kept for display context.
  subredditLabel: string;
}

const CHANNEL_MAP: Record<string, ChannelConfig> = {
  ecommerce: { lemmyCommunity: "BuyItForLife", label: "E-Commerce Reviews", subredditLabel: "BuyItForLife" },
  "food-delivery": { lemmyCommunity: "food", label: "Food Delivery", subredditLabel: "doordash" },
  streaming: { lemmyCommunity: "movies", label: "Streaming Feedback", subredditLabel: "netflix" },
  support: { lemmyCommunity: "techsupport", label: "Support Tickets", subredditLabel: "techsupport" },
};

interface LemmyCommentChild {
  comment: {
    id: number;
    content: string;
    ap_id?: string;
    published?: string;
    removed?: boolean;
    deleted?: boolean;
    distinguished?: boolean;
  };
  creator: {
    id: number;
    name: string;
    display_name?: string;
    actor_id?: string;
    banned?: boolean;
  };
  post: {
    id: number;
    name: string;
    url?: string;
    ap_id?: string;
  };
  community: {
    id: number;
    name: string;
    title?: string;
  };
  counts?: {
    score: number;
    upvotes: number;
    downvotes: number;
  };
}

interface LemmyResponse {
  comments: LemmyCommentChild[];
}

export interface RedditFeedItem {
  id: string;
  text: string;
  author: string;
  channel: string;
  channelLabel: string;
  subreddit: string; // community name on Lemmy (kept as "subreddit" for UI compat)
  timestamp: number; // seconds since epoch
  score: number;
  postTitle?: string;
  source: "lemmy" | "reddit";
}

/**
 * Strip Lemmy/Reddit-flavored markdown artifacts that would confuse the
 * sentiment model. We don't try to fully render markdown — just remove the
 * structural noise (links, mentions, quote prefixes).
 */
function cleanText(raw: string): string {
  if (!raw) return "";
  let t = raw;
  // Remove markdown URLs: [text](http://...)
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1");
  // Strip raw URLs
  t = t.replace(/https?:\/\/[^\s)]+/g, "");
  // Remove community mentions !xyz@instance
  t = t.replace(/!?[A-Za-z0-9_]+@[A-Za-z0-9.-]+/g, "");
  // Remove user mentions @xyz@instance
  t = t.replace(/@?[A-Za-z0-9_]+@[A-Za-z0-9.-]+\b/g, "");
  // Remove markdown quote prefixes (> ...)
  t = t.replace(/^>\s?/gm, "");
  // Strip markdown emphasis (italic/bold) — keeps the words, drops asterisks
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1");
  // Collapse whitespace
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > 500) t = t.slice(0, 500).trim() + "…";
  return t;
}

function isoToSeconds(iso?: string): number {
  if (!iso) return Math.floor(Date.now() / 1000);
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Math.floor(Date.now() / 1000) : Math.floor(t / 1000);
}

async function fetchLemmyChannel(cfg: ChannelConfig, channelId: string): Promise<RedditFeedItem[]> {
  // Get newest comments from the community. type=Community + community_name
  // filters to a single community.
  const url = `https://lemmy.world/api/v3/comment/list?type=Community&community_name=${encodeURIComponent(
    cfg.lemmyCommunity
  )}&sort=New&limit=10&max_depth=2`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Sentira/1.0 (sentiment-analysis-fyp)",
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  if (res.status === 429) {
    throw new Error("rate-limited");
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const json = (await res.json()) as LemmyResponse;
  const comments = json?.comments ?? [];

  const items: RedditFeedItem[] = [];
  for (const c of comments) {
    if (!c.comment?.content) continue;
    if (c.comment.removed || c.comment.deleted) continue;
    const text = cleanText(c.comment.content);
    if (text.length < 4) continue;
    const author = c.creator?.display_name || c.creator?.name || "[deleted]";
    items.push({
      id: `lemmy-${cfg.lemmyCommunity}-${c.comment.id}`,
      text,
      author,
      channel: channelId,
      channelLabel: cfg.label,
      subreddit: cfg.lemmyCommunity,
      timestamp: isoToSeconds(c.comment.published),
      score: c.counts?.score ?? 0,
      postTitle: c.post?.name,
      source: "lemmy",
    });
  }
  return items;
}

/**
 * Attempt to fetch from Reddit's public JSON endpoint. As of 2024+ this
 * requires OAuth and returns 403 for unauthenticated requests — but we
 * try anyway in case Reddit's policy changes back or the network allows it.
 */
async function fetchRedditChannel(cfg: ChannelConfig, channelId: string): Promise<RedditFeedItem[]> {
  const url = `https://www.reddit.com/r/${cfg.subredditLabel}/comments.json?limit=10`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Sentira/1.0 (sentiment-analysis-fyp)",
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    data?: {
      children?: Array<{
        data?: {
          body?: string;
          author?: string;
          created_utc?: number;
          score?: number;
          id?: string;
          link_title?: string;
        };
      }>;
    };
  };

  const items: RedditFeedItem[] = [];
  for (const child of json?.data?.children ?? []) {
    const d = child?.data;
    if (!d?.body) continue;
    const text = cleanText(d.body);
    if (text.length < 4) continue;
    items.push({
      id: `reddit-${cfg.subredditLabel}-${d.id ?? Math.random().toString(36).slice(2)}`,
      text,
      author: d.author ?? "[deleted]",
      channel: channelId,
      channelLabel: cfg.label,
      subreddit: cfg.subredditLabel,
      timestamp: d.created_utc ?? Math.floor(Date.now() / 1000),
      score: d.score ?? 0,
      postTitle: d.link_title,
      source: "reddit",
    });
  }
  return items;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const channel = searchParams.get("channel") ?? "all";

  const targets =
    channel === "all" || !CHANNEL_MAP[channel]
      ? Object.entries(CHANNEL_MAP)
      : [[channel, CHANNEL_MAP[channel]] as const];

  const allItems: RedditFeedItem[] = [];
  const errors: { channel: string; error: string }[] = [];

  await Promise.all(
    targets.map(async ([id, cfg]) => {
      // Try Lemmy first (the working source); fall back to Reddit.
      try {
        const items = await fetchLemmyChannel(cfg, id);
        if (items.length > 0) {
          allItems.push(...items);
          return;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "lemmy error";
        // If Lemmy failed for any reason, try Reddit as a fallback.
        try {
          const items = await fetchRedditChannel(cfg, id);
          if (items.length > 0) {
            allItems.push(...items);
            return;
          }
        } catch {
          // Both failed — record the original Lemmy error.
          errors.push({ channel: cfg.label, error: msg });
          return;
        }
        errors.push({ channel: cfg.label, error: "no comments from either source" });
      }
    })
  );

  if (allItems.length === 0 && errors.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        items: [],
        errors,
        message: "Live feed sources are rate-limited or unreachable. Try again in a few seconds.",
      },
      { status: 200 }
    );
  }

  // Sort by recency (newest first)
  allItems.sort((a, b) => b.timestamp - a.timestamp);

  return NextResponse.json({
    ok: true,
    items: allItems,
    errors,
    fetchedAt: Date.now(),
  });
}
