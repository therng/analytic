import * as cheerio from "cheerio";
import { normalise, type NewsItem } from "@/lib/news-normalizer";

const FXSTREET_RSS = "https://www.fxstreet.com/rss/news";

const RELEVANT_KEYWORDS = [
  // Gold
  "gold", "xauusd", "xau/usd", "xau", "bullion", "precious metal",
  // Oil
  "oil", "crude", "wti", "brent", "petroleum", "opec",
  // Dollar / USD
  "dollar", "usd", "dxy", "greenback", "federal reserve", "fed", "fomc",
];

function isRelevant(title: string, description: string): boolean {
  const combined = (title + " " + description).toLowerCase();
  return RELEVANT_KEYWORDS.some((kw) => combined.includes(kw));
}

export async function fetchFXStreetNews(): Promise<NewsItem[]> {
  const res = await fetch(FXSTREET_RSS, {
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
    const description = $(el).find("description").first().text().trim();
    const link =
      $(el).find("link").first().text().trim() ||
      $(el).find("guid").first().text().trim();
    const pubDate = $(el).find("pubDate").first().text().trim();

    if (!title || !link) return;
    if (!isRelevant(title, description)) return;

    items.push(
      normalise({
        title,
        link,
        source: "FXStreet",
        publishedAt: pubDate
          ? new Date(pubDate).toISOString()
          : new Date().toISOString(),
      }),
    );
  });

  return items;
}
