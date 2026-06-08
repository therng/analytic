"use client";

import { memo, useEffect, useState } from "react";
import type { NewsItem } from "@/lib/news-normalizer";

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

type Sentiment = "bullish" | "neutral" | "bearish";

function SentimentBadge({ value }: { value: Sentiment | undefined }) {
  if (value === "bullish") return <span className="news-badge news-badge--bullish">▲</span>;
  if (value === "bearish") return <span className="news-badge news-badge--bearish">▼</span>;
  return <span className="news-badge news-badge--neutral">●</span>;
}

function NewsRow({ item }: { item: NewsItem }) {
  const isHighImpact = item.impact === "high";
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className={`news-row${isHighImpact ? " news-row--high-impact" : ""}`}
    >
      {isHighImpact && <span className="news-row__impact-dot" aria-label="High impact" />}
      <span className="news-row__title">{item.title}</span>
      <span className="news-row__meta">
        <span className="news-row__time">{relativeTime(item.publishedAt)}</span>
        <span className="news-row__source">[{item.source}]</span>
        {!isHighImpact && <SentimentBadge value={item.sentiment} />}
      </span>
    </a>
  );
}

function XauusdNewsFeedInner() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/news?symbol=XAUUSD");
        if (!res.ok) throw new Error("fetch failed");
        const data: NewsItem[] = await res.json();
        if (!cancelled) setItems(data);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 300_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (loading) {
    return (
      <div className="news-feed">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="news-skeleton">
            <div className="news-skeleton__line news-skeleton__line--title1" />
            <div className="news-skeleton__line news-skeleton__line--title2" />
            <div className="news-skeleton__line news-skeleton__line--meta" />
          </div>
        ))}
      </div>
    );
  }

  if (error || items.length === 0) {
    return <div className="news-feed news-feed--empty">No news available</div>;
  }

  return (
    <div className="news-feed">
      {items.map((item) => (
        <NewsRow key={item.id} item={item} />
      ))}
    </div>
  );
}

export const XauusdNewsFeed = memo(XauusdNewsFeedInner);
