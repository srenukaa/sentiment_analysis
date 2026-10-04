/**
 * Sentira — channel metadata + brand keyword targeting.
 *
 * Each channel maps to:
 *   - A subreddit where brand-relevant discussions happen
 *   - A set of brand keywords that the backend searches for
 *
 * The backend proxy at /api/webhook/reddit-feed searches the subreddit
 * for posts mentioning these brands, then fetches each matching post's
 * comments thread. The frontend runs two-tier sentiment analysis on
 * (post body) and (aggregated comments).
 */

export interface ChannelDef {
  id: string;
  label: string;
  blurb: string;
  subreddit: string;
  /** Brand/keyword phrases to search for. Reddit search uses OR semantics. */
  brands: string[];
  /** Display name for the matched brand badge (auto-detected per post). */
  brandDisplayNames: Record<string, string>;
}

export const CHANNELS: ChannelDef[] = [
  {
    id: "ecommerce",
    label: "E-Commerce Reviews",
    blurb: "Brand-keyword search for Amazon & Flipkart posts on r/india.",
    subreddit: "india",
    brands: ["amazon", "flipkart"],
    brandDisplayNames: {
      amazon: "Amazon",
      flipkart: "Flipkart",
    },
  },
  {
    id: "food-delivery",
    label: "Food Delivery",
    blurb: "Brand-keyword search for Zomato & Swiggy posts on r/india.",
    subreddit: "india",
    brands: ["zomato", "swiggy"],
    brandDisplayNames: {
      zomato: "Zomato",
      swiggy: "Swiggy",
    },
  },
  {
    id: "streaming",
    label: "Streaming Feedback",
    blurb: "Brand-keyword search for Netflix & Prime Video posts on r/television.",
    subreddit: "television",
    brands: ["netflix", "prime video"],
    brandDisplayNames: {
      netflix: "Netflix",
      "prime video": "Prime Video",
    },
  },
  {
    id: "support",
    label: "Support Tickets",
    blurb: "Keyword search for error / bug / crash / fix on r/techsupport.",
    subreddit: "techsupport",
    brands: ["error", "bug", "crash", "fix"],
    brandDisplayNames: {
      error: "Error",
      bug: "Bug",
      crash: "Crash",
      fix: "Fix",
    },
  },
];

export const DEFAULT_CHANNEL = "all";

export function channelLabel(id: string): string {
  return CHANNELS.find((c) => c.id === id)?.label ?? id;
}

/**
 * Detect which brand a post is "about" based on which keyword appears in
 * its title/body. Falls back to the first brand for the channel if no
 * match is found (the post came up in the brand search, so it's relevant
 * even if the brand name itself isn't in the text — could be a code-name
 * or just adjacent discussion).
 */
export function detectBrand(
  text: string,
  brands: string[],
  brandDisplayNames: Record<string, string>
): { key: string; displayName: string } {
  const lower = text.toLowerCase();
  for (const b of brands) {
    if (lower.includes(b.toLowerCase())) {
      return { key: b, displayName: brandDisplayNames[b] ?? b };
    }
  }
  return {
    key: brands[0],
    displayName: brandDisplayNames[brands[0]] ?? brands[0],
  };
}
