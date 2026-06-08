import { NextResponse } from "next/server";
import { fetchInfoQuestNews } from "@/services/infoquest";
import { fetchForexFactoryHighImpact } from "@/services/forexfactory";
import { deduplicate } from "@/lib/deduplicate";
import { applySentiment } from "@/lib/sentiment";
import type { NewsItem } from "@/lib/news-normalizer";

const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache: { items: NewsItem[]; at: number } | null = null;

async function aggregateNews(): Promise<NewsItem[]> {
  const [iqResult, ffResult] = await Promise.allSettled([
    fetchInfoQuestNews(),
    fetchForexFactoryHighImpact(),
  ]);

  const raw: NewsItem[] = [
    ...(iqResult.status === "fulfilled" ? iqResult.value : []),
    ...(ffResult.status === "fulfilled" ? ffResult.value : []),
  ];

  const items = deduplicate(raw);
  // Apply sentiment to text-based news only; ForexFactory events carry factual data
  applySentiment(items.filter((i) => i.source !== "ForexFactory"));
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
