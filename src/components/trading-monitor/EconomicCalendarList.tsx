"use client";
import { memo, useEffect, useState } from "react";
import type {
  EconomicEvent,
  EconomicEventsResponse,
} from "@/app/api/economic-events/route";

function useEconomicEvents() {
  const [events, setEvents] = useState<EconomicEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const res = await fetch("/api/economic-events?scope=expanded");
        if (!res.ok) throw new Error();
        const data: EconomicEventsResponse = await res.json();
        if (alive) {
          setEvents(data.events);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  return { events, loading, error };
}

function EcoDateRow({ label, isToday }: { label: string; isToday: boolean }) {
  return (
    <div className={`eco-date-row${isToday ? " eco-date-row--today" : ""}`}>
      {isToday ? "Today" : label}
    </div>
  );
}

function EcoRow({ ev }: { ev: EconomicEvent }) {
  const isHoliday = ev.impact === "Holiday";

  return (
    <div
      className={[
        "eco-row",
        ev.status === "released" ? "eco-row--released" : "",
        isHoliday ? "eco-row--holiday" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        className={`eco-row__dot${isHoliday ? " eco-row__dot--holiday" : ""}`}
        aria-hidden="true"
      />
      <span className="eco-row__time">
        {ev.time || <span className="eco-row__allday">—</span>}
      </span>
      <span className="eco-row__name" title={ev.name}>
        {ev.name}
      </span>
      <span className="eco-row__vals">
        {ev.actual && (
          <span className="eco-row__val eco-row__val--actual">{ev.actual}</span>
        )}
        {ev.forecast && (
          <span className="eco-row__val eco-row__val--forecast">
            {ev.forecast}
          </span>
        )}
        {ev.previous && (
          <span className="eco-row__val eco-row__val--prev">{ev.previous}</span>
        )}
      </span>
    </div>
  );
}

type DateGroup = { label: string; isToday: boolean; events: EconomicEvent[] };

function groupByDate(events: EconomicEvent[]): DateGroup[] {
  const map = new Map<string, DateGroup>();
  for (const ev of events) {
    const key = ev.dateLabel;
    if (!map.has(key))
      map.set(key, { label: key, isToday: ev.isToday, events: [] });
    map.get(key)!.events.push(ev);
  }
  return Array.from(map.values());
}

function EconomicCalendarListInner() {
  const { events, loading, error } = useEconomicEvents();

  if (loading) {
    return (
      <div className="eco-cal__state">
        <span className="eco-cal__state-icon">◌</span>
        <span>Loading…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="eco-cal__state eco-cal__state--error">
        <span className="eco-cal__state-icon">✕</span>
        <span>Unable to load events</span>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="eco-cal__state">
        <span className="eco-cal__state-icon">○</span>
        <span>No upcoming events</span>
      </div>
    );
  }

  const groups = groupByDate(events);

  return (
    <div className="eco-cal__list" role="list">
      {groups.map((group) => (
        <div key={group.label}>
          <EcoDateRow label={group.label} isToday={group.isToday} />
          {group.events.map((ev) => (
            <EcoRow key={ev.id} ev={ev} />
          ))}
        </div>
      ))}
    </div>
  );
}

export const EconomicCalendarList = memo(EconomicCalendarListInner);
