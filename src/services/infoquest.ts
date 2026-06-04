import * as cheerio from "cheerio";
import { normalise, type NewsItem } from "@/lib/news-normalizer";

const BASE = "https://www.infoquest.co.th/tag";

// Tag-specific feeds — pre-filtered by InfoQuest, no keyword matching needed
const TAG_FEEDS = [
  `${BASE}/${encodeURIComponent("ทอง")}/feed`,
  `${BASE}/${encodeURIComponent("ทองคำ")}/feed`,
  `${BASE}/${encodeURIComponent("ราคาทองคำ")}/feed`,
  `${BASE}/comex/feed`,
];

async function fetchTag(url: string): Promise<NewsItem[]> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Analytic/1.0)",
      "Accept": "application/rss+xml, application/xml, text/xml",
    },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) return [];

  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });

  const items: NewsItem[] = [];
  $("item").each((_, el) => {
    const title = $(el).find("title").first().text().trim();
    const link =
      $(el).find("link").first().text().trim() ||
      $(el).find("guid").first().text().trim();
    const pubDate = $(el).find("pubDate").first().text().trim();

    if (!title || !link) return;

    items.push(
      normalise({
        title,
        link,
        source: "InfoQuest",
        publishedAt: pubDate
          ? new Date(pubDate).toISOString()
          : new Date().toISOString(),
      }),
    );
  });

  return items;
}

export async function fetchInfoQuestNews(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(TAG_FEEDS.map(fetchTag));

  const all: NewsItem[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") all.push(...result.value);
  }
  return all;
}
