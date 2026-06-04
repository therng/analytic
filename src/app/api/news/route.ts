import { NextResponse } from "next/server";
import { fetchInfoQuestNews } from "@/services/infoquest";
import { applySentiment } from "@/lib/sentiment";
import type { NewsItem } from "@/lib/news-normalizer";

const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache: { items: NewsItem[]; at: number } | null = null;

async function aggregateNews(): Promise<NewsItem[]> {
  const items = await fetchInfoQuestNews();
  applySentiment(items);
  items.sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
  return items.slice(0, 50);
}

export async function GET() {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) {
    return NextResponse.json(_cache.items);
  }

  try {
    const items = await aggregateNews();
    _cache = { items, at: Date.now() };
    return NextResponse.json(items);
  } catch (error) {
    console.error("[news] aggregation error:", error);
    return NextResponse.json(_cache?.items ?? []);
  }
}
