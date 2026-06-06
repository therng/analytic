"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { EconomicEvent, EconomicEventsResponse } from "@/app/api/economic-events/route";

function sortByUpcomingFirst(events: EconomicEvent[]): EconomicEvent[] {
  return [...events].sort((a, b) => {
    const rank = (e: EconomicEvent) =>
      e.status === "upcoming" ? 0 : e.status === "holiday" ? 1 : 2;
    return rank(a) - rank(b);
  });
}

function filterToNextSlot(events: EconomicEvent[]): EconomicEvent[] {
  if (events.length === 0) return events;
  const upcoming = events.filter((e) => e.status === "upcoming");
  const anchor = upcoming.length > 0 ? upcoming[0]! : events[events.length - 1]!;
  const key = `${anchor.dateLabel}|${anchor.time}`;
  return events.filter((e) => `${e.dateLabel}|${e.time}` === key).slice(0, 3);
}

function headerDate(events: EconomicEvent[]): string | null {
  if (events.length === 0) return null;
  const first = events[0]!.dateLabel;
  return events.every((e) => e.dateLabel === first) ? first : "This Week";
}

function ActualComparison({ event }: { event: EconomicEvent }) {
  if (!event.actual || !event.forecast) return null;
  const act = parseFloat(event.actual.replace(/[^0-9.-]/g, ""));
  const fcst = parseFloat(event.forecast.replace(/[^0-9.-]/g, ""));
  if (isNaN(act) || isNaN(fcst)) return null;
  const isPositive = act > fcst;
  return (
    <span className={`eco-cal__detail-signal ${isPositive ? "eco-cal__detail-signal--bull" : "eco-cal__detail-signal--bear"}`}>
      {isPositive ? "▲ สูงกว่าคาด → USD แข็ง" : "▼ ต่ำกว่าคาด → USD อ่อน"}
    </span>
  );
}

function EcoCalDetail({ event, onClose }: { event: EconomicEvent; onClose: () => void }) {
  const statusTh =
    event.status === "upcoming" ? "กำลังจะมาถึง" :
    event.status === "released" ? "ประกาศแล้ว" : "วันหยุด";

  return (
    <div className="eco-cal__detail" role="dialog" aria-modal="true">
      <div className="eco-cal__detail-handle" aria-hidden="true" />
      <div className="eco-cal__detail-header">
        <span className="eco-cal__detail-flag">
          <FlagIcon />
        </span>
        <span className="eco-cal__detail-title">
          {event.name}
        </span>
        <button
          type="button"
          className="eco-cal__detail-close"
          onClick={onClose}
          aria-label="ปิด"
        >
          ✕
        </button>
      </div>

      <div className="eco-cal__detail-grid">
        <div className="eco-cal__detail-cell">
          <span className="eco-cal__detail-cell-label">Time</span>
          <span className="eco-cal__detail-cell-val">{event.time || "All Day"}</span>
        </div>
        <div className="eco-cal__detail-cell">
          <span className="eco-cal__detail-cell-label">Status</span>
          <span className={`eco-cal__detail-cell-val eco-cal__detail-status--${event.status}`}>{statusTh}</span>
        </div>
        <div className="eco-cal__detail-cell">
          <span className="eco-cal__detail-cell-label">Actual</span>
          <span className="eco-cal__detail-cell-val eco-cal__detail-cell-val--act" data-filled={event.actual != null ? "" : undefined}>{event.actual ?? "—"}</span>
        </div>
        <div className="eco-cal__detail-cell">
          <span className="eco-cal__detail-cell-label">Forecast</span>
          <span className="eco-cal__detail-cell-val">{event.forecast ?? "—"}</span>
        </div>
        <div className="eco-cal__detail-cell">
          <span className="eco-cal__detail-cell-label">Previous</span>
          <span className="eco-cal__detail-cell-val">{event.previous ?? "—"}</span>
        </div>
        <div className="eco-cal__detail-cell">
          <span className="eco-cal__detail-cell-label">Impact</span>
          <span className="eco-cal__detail-cell-val eco-cal__detail-impact">High 🔴</span>
        </div>
      </div>

      <ActualComparison event={event} />
    </div>
  );
}

function FlagIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
      <line x1="2.5" y1="1" x2="2.5" y2="10" stroke="#f04d4d" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2.5 1.5L9.5 3.5L2.5 5.5Z" fill="#f04d4d" />
    </svg>
  );
}

function ChipHeaders() {
  return (
    <div className="eco-cal__chip-heads">
      <span className="eco-cal__chip-head">Act</span>
      <span className="eco-cal__chip-head">Fcst</span>
      <span className="eco-cal__chip-head">Prev</span>
    </div>
  );
}

function EcoCalRow({
  event,
  onLongPress,
}: {
  event: EconomicEvent;
  onLongPress: (event: EconomicEvent) => void;
}) {
  const isUpcoming = event.status === "upcoming";
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startPress = useCallback(() => {
    timerRef.current = setTimeout(() => {
      onLongPress(event);
    }, 450);
  }, [event, onLongPress]);

  const cancelPress = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return (
    <div
      className={`eco-cal__row${isUpcoming ? " eco-cal__row--upcoming" : ""}`}
      onPointerDown={startPress}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      role="button"
      tabIndex={0}
      aria-label={`กดค้างเพื่อดูรายละเอียด: ${event.name}`}
      onKeyDown={(e) => { if (e.key === "Enter") onLongPress(event); }}
    >
      <div className="eco-cal__time-col">
        {isUpcoming && <span className="eco-cal__pulse-dot" aria-hidden="true" />}
        <span className="eco-cal__time">{event.time || "ทั้งวัน"}</span>
      </div>
      <span className="eco-cal__name">
        <span className="eco-cal__name-th">{event.name}</span>
      </span>
      <span className="eco-cal__chips">
        <span
          className="eco-cal__chip eco-cal__chip--act"
          data-filled={event.actual != null ? "true" : undefined}
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
  const [activeEvent, setActiveEvent] = useState<EconomicEvent | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/economic-events");
        if (!res.ok) throw new Error("fetch failed");
        const data: EconomicEventsResponse = await res.json();
        if (!cancelled && data && Array.isArray(data.events)) {
          setEvents(filterToNextSlot(sortByUpcomingFirst(data.events)));
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleLongPress = useCallback((event: EconomicEvent) => {
    setActiveEvent(event);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setActiveEvent(null);
  }, []);

  const date = headerDate(events);

  if (loading) {
    return (
      <div className="eco-cal">
        <div className="eco-cal__head">
          <span className="eco-cal__label">
            <FlagIcon />
            USD High Impact
          </span>
          <ChipHeaders />
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
    <div className="eco-cal" style={{ position: "relative" }}>
      <div className="eco-cal__head">
        <span className="eco-cal__label">
          {date && <span className="eco-cal__date">{date}</span>}
        </span>
        <ChipHeaders />
      </div>

      {events.map((event) => (
        <EcoCalRow key={event.id} event={event} onLongPress={handleLongPress} />
      ))}

      {activeEvent && (
        <>
          <div
            className="eco-cal__detail-backdrop"
            onClick={handleCloseDetail}
            aria-hidden="true"
          />
          <EcoCalDetail event={activeEvent} onClose={handleCloseDetail} />
        </>
      )}
    </div>
  );
}

export const EconomicCalendarPanel = memo(EconomicCalendarPanelInner);
