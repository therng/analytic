import * as cheerio from "cheerio";
import { normalise, type NewsItem } from "@/lib/news-normalizer";

const FF_FEEDS = [
  "https://www.forexfactory.com/ffcal_week_this.xml",
  "https://www.forexfactory.com/ffcal_week_next.xml",
];

function parseImpact(raw: string): "high" | "medium" | "low" | undefined {
  const lower = raw.toLowerCase().replace(/<[^>]+>/g, "").trim();
  if (lower.includes("high")) return "high";
  if (lower.includes("medium")) return "medium";
  if (lower.includes("low")) return "low";
  return undefined;
}

function parseEventDate(date: string, time: string): string {
  try {
    const base = new Date(date);
    if (!time || /all day|tentative/i.test(time)) return base.toISOString();
    const m = time.match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
    if (m) {
      let h = parseInt(m[1]);
      const min = parseInt(m[2]);
      const period = m[3].toLowerCase();
      if (period === "pm" && h !== 12) h += 12;
      if (period === "am" && h === 12) h = 0;
      base.setHours(h, min, 0, 0);
    }
    return base.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function buildTitle(name: string, actual: string, forecast: string, previous: string): string {
  if (actual) {
    const parts = [`Actual: ${actual}`];
    if (forecast) parts.push(`Fcst: ${forecast}`);
    if (previous) parts.push(`Prev: ${previous}`);
    return `${name} — ${parts.join(" / ")}`;
  }
  if (forecast) return `${name} — Fcst: ${forecast}`;
  return name;
}

async function fetchFeed(url: string): Promise<NewsItem[]> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Analytic/1.0; +https://github.com/analytic)",
      "Accept": "application/xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });

  if (!res.ok) return [];

  const xml = await res.text();
  const $ = cheerio.load(xml, { xmlMode: true });

  const items: NewsItem[] = [];

  $("event").each((_, el) => {
    const $el = $(el);
    const country = $el.find("country").first().text().trim();
    if (country !== "USD") return;

    const rawImpact = $el.find("impact").first().text().trim();
    const impact = parseImpact(rawImpact);
    if (impact !== "high") return;

    const name = $el.find("title").first().text().trim();
    const date = $el.find("date").first().text().trim();
    const time = $el.find("time").first().text().trim();
    const actual = $el.find("actual").first().text().trim();
    const forecast = $el.find("forecast").first().text().trim();
    const previous = $el.find("previous").first().text().trim();

    if (!name || !date) return;

    const title = buildTitle(name, actual, forecast, previous);
    const slug = Buffer.from(name + date).toString("base64url").slice(0, 10);

    items.push(
      normalise({
        title,
        link: `https://www.forexfactory.com/calendar#${slug}`,
        source: "ForexFactory",
        publishedAt: parseEventDate(date, time),
        impact: "high",
      }),
    );
  });

  return items;
}

export async function fetchForexFactoryHighImpact(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(FF_FEEDS.map(fetchFeed));
  const all: NewsItem[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") all.push(...r.value);
  }
  return all;
}
