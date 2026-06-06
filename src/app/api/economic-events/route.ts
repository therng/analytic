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
  scope: "default" | "expanded";
  queryScope: "today" | "week" | "empty";
};

type DerivedEconomicEvent = EconomicEvent & {
  startsAt: number;
};

// Forex Factory public calendar JSON
type FFEvent = {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
  actual?: string;
};

type CalendarWeek = "lastweek" | "thisweek" | "nextweek";

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
const EXPANDED_HISTORY_DAYS = 30;

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
  if (isHoliday) return "holiday";
  if (isValidDate && eventTime > nowTime) return "upcoming";
  return "released";
}

function toQueryScope(
  todayCount: number,
  eventCount: number,
): EconomicEventsResponse["queryScope"] {
  if (todayCount > 0) return "today";
  if (eventCount > 0) return "week";
  return "empty";
}

async function fetchCalendarFeed(week: CalendarWeek = "thisweek"): Promise<FFEvent[] | null> {
  const filename = `ff_calendar_${week}.json`;
  const urls = [
    `https://nfs.faireconomy.media/${filename}`,
    `https://cdn-nfs.faireconomy.media/${filename}`,
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

      if (!response.ok) continue;

      const raw = (await response.json()) as FFEvent[] | null;
      if (Array.isArray(raw)) return raw;
    } catch {
      /* try next mirror */
    }
  }

  return null;
}

function normalizeFeedEvents(
  raw: FFEvent[],
  todayBKK: string,
  nowTime: number,
  cutoffMs?: number,
): DerivedEconomicEvent[] {
  return raw
    .filter((ev) => {
      if (!ev.date || !ev.country) return false;
      if (ev.country.toUpperCase() !== "USD") return false;
      const impact = ev.impact ?? "";
      if (impact !== "High" && impact !== "Holiday") return false;
      if (cutoffMs !== undefined) {
        const d = new Date(ev.date);
        if (!isNaN(d.getTime()) && d.getTime() < cutoffMs) return false;
      }
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
    });
}

export async function GET(req: Request): Promise<NextResponse<EconomicEventsResponse>> {
  const { searchParams } = new URL(req.url);
  const isExpanded = searchParams.get("scope") === "expanded";

  const todayBKK = bangkokDateString();
  const now = new Date();
  const nowTime = now.getTime();

  try {
    if (isExpanded) {
      // Fetch lastweek + thisweek + nextweek in parallel; cut events older than 30 days
      const cutoffMs = nowTime - EXPANDED_HISTORY_DAYS * 24 * 60 * 60 * 1000;
      const [last, current, next] = await Promise.all([
        fetchCalendarFeed("lastweek"),
        fetchCalendarFeed("thisweek"),
        fetchCalendarFeed("nextweek"),
      ]);

      const allRaw = [...(last ?? []), ...(current ?? []), ...(next ?? [])];
      if (allRaw.length === 0) {
        return NextResponse.json({ events: [], date: todayBKK, scope: "expanded", queryScope: "empty" });
      }

      const derived = normalizeFeedEvents(allRaw, todayBKK, nowTime, cutoffMs);

      // Dedup by composite key (country + title + date rounded to hour)
      const seen = new Set<string>();
      const deduped = derived.filter((ev) => {
        const key = `${ev.currency}|${ev.name}|${Math.floor(ev.startsAt / 3_600_000)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      deduped.sort((a, b) => {
        if (a.impact === "Holiday" && b.impact !== "Holiday") return 1;
        if (a.impact !== "Holiday" && b.impact === "Holiday") return -1;
        return a.startsAt - b.startsAt;
      });

      const todayCount = deduped.filter((e) => e.isToday).length;
      const events: EconomicEvent[] = deduped.map(({ startsAt: _s, ...ev }) => ev);

      return NextResponse.json({
        events,
        date: todayBKK,
        scope: "expanded",
        queryScope: toQueryScope(todayCount, events.length),
      });
    }

    // Default scope — same logic as before
    const raw = await fetchCalendarFeed("thisweek");
    if (!Array.isArray(raw)) {
      return NextResponse.json({ events: [], date: todayBKK, scope: "default", queryScope: "empty" });
    }

    const allEvents = normalizeFeedEvents(raw, todayBKK, nowTime);
    allEvents.sort((a, b) => {
      if (a.impact === "Holiday" && b.impact !== "Holiday") return 1;
      if (a.impact !== "Holiday" && b.impact === "Holiday") return -1;
      return a.startsAt - b.startsAt;
    });

    const todayEvents = allEvents.filter((e) => e.isToday);
    const upcomingEvents = allEvents.filter((e) => e.status === "upcoming");
    const releasedEvents = allEvents.filter((e) => e.status === "released");

    const selectedEvents =
      todayEvents.length > 0
        ? todayEvents
        : upcomingEvents.length > 0
          ? upcomingEvents.slice(0, MAX_FALLBACK_EVENTS)
          : releasedEvents.slice(-MAX_FALLBACK_EVENTS);

    const events: EconomicEvent[] = selectedEvents.map(({ startsAt: _s, ...ev }) => ev);
    const queryScope = toQueryScope(todayEvents.length, events.length);

    return NextResponse.json({ events, date: todayBKK, scope: "default", queryScope });
  } catch {
    return NextResponse.json({ events: [], date: todayBKK, scope: isExpanded ? "expanded" : "default", queryScope: "empty" });
  }
}
