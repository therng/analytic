import type { NewsItem } from "@/lib/news-normalizer";

const BULLISH = [
  "rally", "rise", "gain", "surge", "jump", "strength",
  "bullish", "climb", "recover", "rebound", "high", "record",
];

const BEARISH = [
  "fall", "drop", "decline", "selloff", "sell-off", "weakness",
  "bearish", "plunge", "tumble", "retreat", "low", "crash",
];

export function classifySentiment(
  title: string,
): "bullish" | "neutral" | "bearish" {
  const lower = title.toLowerCase();
  const bullishScore = BULLISH.filter((w) => lower.includes(w)).length;
  const bearishScore = BEARISH.filter((w) => lower.includes(w)).length;
  if (bullishScore > bearishScore) return "bullish";
  if (bearishScore > bullishScore) return "bearish";
  return "neutral";
}

export function applySentiment(items: NewsItem[]): NewsItem[] {
  for (const item of items) {
    item.sentiment = classifySentiment(item.title);
  }
  return items;
}
