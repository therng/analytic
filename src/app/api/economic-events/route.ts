import { NextResponse } from "next/server";

import { getBangkokDateKey, getBangkokDateParts } from "@/lib/time";

export const dynamic = "force-dynamic";

export type EconomicEvent = {
  id: string;
  name: string;
  currency: string;
  impact: "High" | "Medium" | "Low" | "Holiday";
  time: string;       // HH:MM Bangkok time, or "" for all-day
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  dateLabel: string;
  isToday: boolean;
  status: "upcoming" | "released" | "holiday";
};

export type EconomicEventsResponse = {
  events: EconomicEvent[];
  date: string;
  scope: "today" | "week" | "empty";
};

type DerivedEconomicEvent = EconomicEvent & {
  startsAt: number;
};

// Forex Factory public calendar JSON
// { title, country, date (ISO with tz offset), impact, forecast, previous }
type FFEvent = {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
  actual?: string;
};

function bangkokDateString(now = new Date()): string {
  return getBangkokDateKey(now) ?? "";
}

function utcToBangkokHHMM(isoDate: string): string {
  const parts = getBangkokDateParts(isoDate);
  if (!parts) return "";
  return `${String(parts.hours).padStart(2, "0")}:${String(parts.minutes).padStart(2, "0")}`;
}

function bangkokDateFromISO(isoDate: string): string {
  return getBangkokDateKey(isoDate) ?? "";
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MAX_FALLBACK_EVENTS = 4;

function formatEventDateLabel(isoDate: string): string {
  const parts = getBangkokDateParts(isoDate);
  if (!parts) return "";
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[parts.month - 1]} ${parts.day}`;
}

function toEventStatus(
  isHoliday: boolean,
  isValidDate: boolean,
  eventTime: number,
  nowTime: number,
): EconomicEvent["status"] {
  if (isHoliday) {
    return "holiday";
  }

  if (isValidDate && eventTime > nowTime) {
    return "upcoming";
  }

  return "released";
}

function toEventScope(
  todayCount: number,
  eventCount: number,
): EconomicEventsResponse["scope"] {
  if (todayCount > 0) {
    return "today";
  }

  if (eventCount > 0) {
    return "week";
  }

  return "empty";
}

async function fetchCalendarFeed() {
  const urls = [
    "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
    "https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.json",
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Analytic/1.0)",
        },
        next: { revalidate: 60 },
      });

      if (!response.ok) {
        continue;
      }

      const raw = (await response.json()) as FFEvent[] | null;
      if (Array.isArray(raw)) {
        return raw;
      }
    } catch {
      /* try next feed */
    }
  }

  return null;
}

export async function GET(): Promise<NextResponse<EconomicEventsResponse>> {
  const todayBKK = bangkokDateString();
  const now = new Date();
  const nowTime = now.getTime();

  try {
    const raw = await fetchCalendarFeed();
    if (!Array.isArray(raw)) {
      return NextResponse.json({ events: [], date: todayBKK, scope: "empty" });
    }

    const allUsdHighImpactEvents: DerivedEconomicEvent[] = raw
      .filter((ev) => {
        if (!ev.date || !ev.country) return false;
        const currency = ev.country.toUpperCase();
        if (currency !== "USD") return false;
        const impact = ev.impact ?? "";
        if (impact !== "High" && impact !== "Holiday") return false;
        // Only today in Bangkok time
        return bangkokDateFromISO(ev.date).length > 0;
      })
      .map((ev, i) => {
        const isoDate = ev.date ?? "";
        const isHoliday = ev.impact === "Holiday";
        const eventDateBKK = bangkokDateFromISO(isoDate);
        const eventTimeLabel = isHoliday ? "" : utcToBangkokHHMM(isoDate);
        const eventDate = new Date(isoDate);
        const isValidDate = !isNaN(eventDate.getTime());
        const isToday = eventDateBKK === todayBKK;
        const eventTimestamp = eventDate.getTime();
        const status = toEventStatus(isHoliday, isValidDate, eventTimestamp, nowTime);

        return {
          id: `${ev.country}-${i}-${isoDate}`,
          name: ev.title ?? "Unknown Event",
          currency: (ev.country ?? "USD").toUpperCase(),
          impact: (isHoliday ? "Holiday" : "High") as EconomicEvent["impact"],
          time: eventTimeLabel,
          forecast: ev.forecast || null,
          previous: ev.previous || null,
          actual: ev.actual?.trim() || null,
          dateLabel: isToday ? "Today" : formatEventDateLabel(isoDate),
          isToday,
          status,
          startsAt: isValidDate ? eventTimestamp : Number.MAX_SAFE_INTEGER,
        };
      })
      .sort((a, b) => {
        if (a.impact === "Holiday" && b.impact !== "Holiday") return 1;
        if (a.impact !== "Holiday" && b.impact === "Holiday") return -1;
        return a.startsAt - b.startsAt;
      });

    const todayEvents = allUsdHighImpactEvents.filter((event) => event.isToday);
    const upcomingEvents = allUsdHighImpactEvents.filter((event) => event.status === "upcoming");
    const releasedEvents = allUsdHighImpactEvents.filter((event) => event.status === "released");

    const selectedEvents =
      todayEvents.length > 0
        ? todayEvents
        : upcomingEvents.length > 0
          ? upcomingEvents.slice(0, MAX_FALLBACK_EVENTS)
          : releasedEvents.slice(-MAX_FALLBACK_EVENTS);

    const events: EconomicEvent[] = selectedEvents.map((event) => ({
      id: event.id,
      name: event.name,
      currency: event.currency,
      impact: event.impact,
      time: event.time,
      forecast: event.forecast,
      previous: event.previous,
      actual: event.actual,
      dateLabel: event.dateLabel,
      isToday: event.isToday,
      status: event.status,
    }));
    const scope = toEventScope(todayEvents.length, events.length);

    return NextResponse.json({ events, date: todayBKK, scope });
  } catch {
    return NextResponse.json({ events: [], date: todayBKK, scope: "empty" });
  }
}
