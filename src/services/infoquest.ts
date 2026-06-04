import * as cheerio from "cheerio";
import { normalise, type NewsItem } from "@/lib/news-normalizer";

const INFOQUEST_RSS_URLS = [
  "https://www.infoquest.co.th/rss",
  "https://www.infoquest.co.th/rss/cat/commodity",
];

// ข่าวผ่านถ้า title มี keyword ทองคำโดยตรง
const GOLD_KEYWORDS = [
  "ทองคำ",
  "ราคาทองคำ",
  "ตลาดทองคำนิวยอร์ก",
  "comex",
];

// หรือ title มี macro keyword + ต้องมี gold keyword ใน description ด้วย
const MACRO_KEYWORDS = [
  "ดอลลาร์",
  "เฟด",
  "เงินเฟ้อ",
  "เศรษฐกิจสหรัฐ",
];

// Thai Unicode block: U+0E00–U+0E7F
const THAI_RE = /[฀-๿]/;

function isThai(text: string): boolean {
  return THAI_RE.test(text);
}

function isRelevant(title: string, description: string): boolean {
  if (!isThai(title)) return false;

  const titleL = title.toLowerCase();
  const combined = (title + " " + description).toLowerCase();

  // ผ่านทันทีถ้า title พูดถึงทองคำโดยตรง
  if (GOLD_KEYWORDS.some((kw) => titleL.includes(kw))) return true;

  // macro keyword (เฟด/เงินเฟ้อ/ฯลฯ) ผ่านได้ก็ต่อเมื่อ description ยังพูดถึงทองคำ
  const hasMacro = MACRO_KEYWORDS.some((kw) => titleL.includes(kw));
  const mentionsGold = GOLD_KEYWORDS.some((kw) => combined.includes(kw));
  return hasMacro && mentionsGold;
}

async function fetchFromUrl(url: string): Promise<NewsItem[] | null> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Analytic/1.0)",
      "Accept": "application/rss+xml, application/xml, text/xml",
    },
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) return null;

  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });

  if ($("item").length === 0) return null;

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
  for (const url of INFOQUEST_RSS_URLS) {
    try {
      const result = await fetchFromUrl(url);
      if (result !== null) return result;
    } catch {
      // try next URL
    }
  }
  return [];
}
