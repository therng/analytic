import type { NewsItem } from "@/lib/news-normalizer";

function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function deduplicate(items: NewsItem[]): NewsItem[] {
  const sorted = [...items].sort(
    (a, b) =>
      new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime(),
  );

  const seenUrls = new Set<string>();
  const seenTitles = new Map<string, true>();
  const result: NewsItem[] = [];

  for (const item of sorted) {
    const key = titleKey(item.title);
    if (seenUrls.has(item.link) || seenTitles.has(key)) continue;
    seenUrls.add(item.link);
    seenTitles.set(key, true);
    result.push(item);
  }

  return result;
}
