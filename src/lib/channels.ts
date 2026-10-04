/**
 * Sentira — channel metadata.
 *
 * Live customer feedback is fetched at runtime via the server-side proxy
 * at /api/webhook/reddit-feed. The proxy uses Reddit's public RSS feeds
 * (which still work without OAuth, unlike the deprecated .json endpoint)
 * to pull authentic comments with permalinks, post titles, and author
 * info. See src/app/api/webhook/reddit-feed/route.ts.
 *
 * Channel → subreddit mapping (each chosen for authentic customer
 * feedback in its vertical):
 *
 *   E-Commerce Reviews   →  r/BuyItForLife    (durable-product reviews)
 *   Food Delivery        →  r/doordash         (driver & order feedback)
 *   Streaming Feedback   →  r/television       (viewer reactions)
 *   Support Tickets      →  r/techsupport      (real troubleshooting threads)
 */

export interface ChannelDef {
  id: string;
  label: string;
  blurb: string;
  subreddit: string;
}

export const CHANNELS: ChannelDef[] = [
  {
    id: "ecommerce",
    label: "E-Commerce Reviews",
    blurb: "Live comments from r/BuyItForLife — durable-product reviews.",
    subreddit: "BuyItForLife",
  },
  {
    id: "food-delivery",
    label: "Food Delivery",
    blurb: "Live comments from r/doordash — driver & order feedback.",
    subreddit: "doordash",
  },
  {
    id: "streaming",
    label: "Streaming Feedback",
    blurb: "Live comments from r/television — viewer reactions.",
    subreddit: "television",
  },
  {
    id: "support",
    label: "Support Tickets",
    blurb: "Live comments from r/techsupport — real troubleshooting threads.",
    subreddit: "techsupport",
  },
];

export const DEFAULT_CHANNEL = "all";

export function channelLabel(id: string): string {
  return CHANNELS.find((c) => c.id === id)?.label ?? id;
}
