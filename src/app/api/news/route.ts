import { NextResponse } from "next/server";
import { fetchFXStreetNews } from "@/services/fxstreet";
import { fetchInfoQuestNews } from "@/services/infoquest";
import { deduplicate } from "@/lib/deduplicate";
import { applySentiment } from "@/lib/sentiment";
import type { NewsItem } from "@/lib/news-normalizer";

const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache: { items: NewsItem[]; at: number } | null = null;

async function aggregateNews(): Promise<NewsItem[]> {
  const results = await Promise.allSettled([
    fetchFXStreetNews(),
    fetchInfoQuestNews(),
  ]);

  const all: NewsItem[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      all.push(...result.value);
    } else {
      console.warn("[news] source failed:", result.reason);
    }
  }

  const unique = deduplicate(all);
  applySentiment(unique);

  unique.sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  return unique.slice(0, 50);
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
