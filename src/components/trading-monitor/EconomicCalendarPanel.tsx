"use client";

import { memo, useEffect, useState } from "react";
import type { EconomicEvent, EconomicEventsResponse } from "@/app/api/economic-events/route";

function sortByUpcomingFirst(events: EconomicEvent[]): EconomicEvent[] {
  return [...events].sort((a, b) => {
    const rank = (e: EconomicEvent) =>
      e.status === "upcoming" ? 0 : e.status === "holiday" ? 1 : 2;
    return rank(a) - rank(b);
  });
}

function headerDate(events: EconomicEvent[]): string | null {
  if (events.length === 0) return null;
  const first = events[0]!.dateLabel;
  return events.every((e) => e.dateLabel === first) ? first : "This Week";
}

function EcoCalRow({ event }: { event: EconomicEvent }) {
  const isUpcoming = event.status === "upcoming";
  return (
    <div className={`eco-cal__row${isUpcoming ? " eco-cal__row--upcoming" : ""}`}>
      <span className="eco-cal__time">{event.time || "All day"}</span>
      <span className="eco-cal__name">{event.name}</span>
      <span className="eco-cal__chips">
        <span
          className="eco-cal__chip eco-cal__chip--act"
          data-filled={event.actual !== null ? "true" : undefined}
        >
          {event.actual ?? "—"}
        </span>
        <span className="eco-cal__chip eco-cal__chip--fcst">
          {event.forecast ?? "—"}
        </span>
        <span className="eco-cal__chip eco-cal__chip--prev">
          {event.previous ?? "—"}
        </span>
      </span>
    </div>
  );
}

function EconomicCalendarPanelInner() {
  const [events, setEvents] = useState<EconomicEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/economic-events");
        if (!res.ok) throw new Error("fetch failed");
        const data: EconomicEventsResponse = await res.json();
        if (!cancelled) setEvents(sortByUpcomingFirst(data.events));
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const date = headerDate(events);

  if (loading) {
    return (
      <div className="eco-cal">
        <div className="eco-cal__head">
          <span className="eco-cal__label">USD High Impact</span>
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="eco-cal__skeleton">
            <div className="eco-cal__skeleton-cell eco-cal__skeleton-cell--time" />
            <div className="eco-cal__skeleton-cell eco-cal__skeleton-cell--name" />
            <div className="eco-cal__skeleton-cell eco-cal__skeleton-cell--chips" />
          </div>
        ))}
      </div>
    );
  }

  if (error || events.length === 0) return null;

  return (
    <div className="eco-cal">
      <div className="eco-cal__head">
        <span className="eco-cal__label">USD High Impact</span>
        {date && <span className="eco-cal__date">{date}</span>}
      </div>
      {events.map((event) => (
        <EcoCalRow key={event.id} event={event} />
      ))}
    </div>
  );
}

export const EconomicCalendarPanel = memo(EconomicCalendarPanelInner);
