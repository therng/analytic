export type NewsItem = {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  sentiment?: "bullish" | "neutral" | "bearish";
  impact?: "high" | "medium" | "low";
};

export function normalise(raw: {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  impact?: "high" | "medium" | "low";
}): NewsItem {
  const id = Buffer.from(raw.link).toString("base64url").slice(0, 32);
  return {
    id,
    title: raw.title.trim(),
    link: raw.link.trim(),
    source: raw.source,
    publishedAt: raw.publishedAt,
    impact: raw.impact,
  };
}
