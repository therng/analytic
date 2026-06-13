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

type ForexFactoryEvent = {
  title?: string;
  country?: string; // currency code: "USD", "EUR", etc.
  date?: string;    // ISO with timezone offset: "2026-06-12T14:00:00-04:00"
  impact?: string;  // "High", "Medium", "Low", "Holiday"
  forecast?: string;
  previous?: string;
  actual?: string;  // populated after the event is released
};

function bangkokDateString(now = new Date()): string {
  return getBangkokDateKey(now) ?? "";
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

function mapImpact(impact: string): EconomicEvent["impact"] {
  const imp = impact.toLowerCase();
  if (imp === "high") return "High";
  if (imp === "medium") return "Medium";
  if (imp === "low") return "Low";
  return "Holiday";
}

async function fetchForexFactoryCalendar(): Promise<ForexFactoryEvent[] | null> {
  const urls = [
    "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
    "https://cdn-nfs.faireconomy.media/ff_calendar_thisweek.json",
  ];

  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; Analytic/1.0)",
        },
        next: { revalidate: 300 },
      });
      clearTimeout(timeout);

      if (!response.ok) continue;

      const raw = await response.json();
      if (Array.isArray(raw)) return raw as ForexFactoryEvent[];
    } catch {
      // try next mirror
    }
  }
  return null;
}

function normalizeEvents(
  raw: ForexFactoryEvent[],
  todayBKK: string,
  nowTime: number,
): DerivedEconomicEvent[] {
  return raw
    .filter((ev) => {
      if (!ev.date || !ev.country) return false;
      if (ev.country.toUpperCase() !== "USD") return false;
      const impact = ev.impact?.toLowerCase() || "";
      return impact === "high" || impact === "holiday";
    })
    .map((ev) => {
      const isHoliday = ev.impact?.toLowerCase() === "holiday";
      const isoDate = ev.date!;
      const parts = getBangkokDateParts(isoDate);
      const eventDateBKK = parts
        ? `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`
        : "";
      const eventTimeLabel = isHoliday || !parts
        ? ""
        : `${String(parts.hours).padStart(2, "0")}:${String(parts.minutes).padStart(2, "0")}`;
      const eventDate = new Date(isoDate);
      const isValidDate = !isNaN(eventDate.getTime());
      const isToday = eventDateBKK === todayBKK;
      const eventTimestamp = isValidDate ? eventDate.getTime() : Number.MAX_SAFE_INTEGER;
      const status = toEventStatus(isHoliday, isValidDate, eventTimestamp, nowTime);

      return {
        id: `USD-${ev.title ?? "Event"}-${isoDate}`,
        name: ev.title ?? "Economic Event",
        currency: "USD",
        impact: mapImpact(ev.impact ?? ""),
        time: eventTimeLabel,
        forecast: ev.forecast || null,
        previous: ev.previous || null,
        actual: ev.actual || null,
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
  const scopeName = isExpanded ? "expanded" : "default";

  const todayBKK = bangkokDateString();
  const now = new Date();
  const nowTime = now.getTime();

  try {
    const raw = await fetchForexFactoryCalendar();

    if (!Array.isArray(raw)) {
      return NextResponse.json({ events: [], date: todayBKK, scope: scopeName, queryScope: "empty" });
    }

    const allEvents = normalizeEvents(raw, todayBKK, nowTime);

    // Dedup by composite key
    const seen = new Set<string>();
    const deduped = allEvents.filter((ev) => {
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

    if (isExpanded) {
      const todayCount = deduped.filter((e) => e.isToday).length;
      const events: EconomicEvent[] = deduped;
      return NextResponse.json({
        events,
        date: todayBKK,
        scope: "expanded",
        queryScope: toQueryScope(todayCount, events.length),
      });
    }

    const todayEvents: DerivedEconomicEvent[] = [];
    const upcomingEvents: DerivedEconomicEvent[] = [];
    const releasedEvents: DerivedEconomicEvent[] = [];

    for (const event of deduped) {
      if (event.isToday) todayEvents.push(event);
      if (event.status === "upcoming") upcomingEvents.push(event);
      else if (event.status === "released") releasedEvents.push(event);
    }

    const selectedEvents =
      todayEvents.length > 0
        ? todayEvents
        : upcomingEvents.length > 0
          ? upcomingEvents.slice(0, MAX_FALLBACK_EVENTS)
          : releasedEvents.slice(-MAX_FALLBACK_EVENTS);

    const events: EconomicEvent[] = selectedEvents;
    return NextResponse.json({
      events,
      date: todayBKK,
      scope: "default",
      queryScope: toQueryScope(todayEvents.length, events.length),
    });
  } catch (err) {
    console.error("GET /api/economic-events failed:", err);
    return NextResponse.json({ events: [], date: todayBKK, scope: scopeName, queryScope: "empty" });
  }
}
