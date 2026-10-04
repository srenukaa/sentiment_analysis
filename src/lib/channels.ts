/**
 * Sentira — channel metadata.
 *
 * Live customer feedback is fetched at runtime via the server-side proxy
 * at /api/webhook/reddit-feed. Because Reddit deprecated anonymous JSON
 * access in 2023, the proxy fetches from Lemmy (a federated Reddit-
 * alternative with a fully open API), with Reddit as a fallback.
 *
 * Channel → community mapping (kept in sync with the server in
 * src/app/api/webhook/reddit-feed/route.ts):
 *
 *   E-Commerce Reviews   →  c/BuyItForLife   (was r/BuyItForLife)
 *   Food Delivery        →  c/food            (was r/doordash)
 *   Streaming Feedback   →  c/movies          (was r/netflix)
 *   Support Tickets      →  c/techsupport     (was r/techsupport)
 */

export interface ChannelDef {
  id: string;
  label: string;
  blurb: string;
  subreddit: string;
  lemmyCommunity: string;
}

export const CHANNELS: ChannelDef[] = [
  {
    id: "ecommerce",
    label: "E-Commerce Reviews",
    blurb: "Live comments from c/BuyItForLife — durable-product reviews.",
    subreddit: "BuyItForLife",
    lemmyCommunity: "BuyItForLife",
  },
  {
    id: "food-delivery",
    label: "Food Delivery",
    blurb: "Live comments from c/food — meal & delivery feedback.",
    subreddit: "doordash",
    lemmyCommunity: "food",
  },
  {
    id: "streaming",
    label: "Streaming Feedback",
    blurb: "Live comments from c/movies — viewer reactions.",
    subreddit: "netflix",
    lemmyCommunity: "movies",
  },
  {
    id: "support",
    label: "Support Tickets",
    blurb: "Live comments from c/techsupport — real troubleshooting threads.",
    subreddit: "techsupport",
    lemmyCommunity: "techsupport",
  },
];

export const DEFAULT_CHANNEL = "all";

export function channelLabel(id: string): string {
  return CHANNELS.find((c) => c.id === id)?.label ?? id;
}
