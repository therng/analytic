import { NextResponse } from "next/server";
import { getBangkokDateKey } from "@/lib/time";
import { prisma } from "@/lib/prisma";
import {
  type EconomicEvent,
  type DerivedEconomicEvent,
  type ForexFactoryEvent,
  fetchForexFactoryCalendar,
  normalizeEvents,
  dedupeAndSort,
} from "@/lib/economic-events/source";

export const dynamic = "force-dynamic";

export type { EconomicEvent };

export type EconomicEventsResponse = {
  events: EconomicEvent[];
  date: string;
  scope: "default" | "expanded";
  queryScope: "today" | "week" | "empty";
};

const MAX_FALLBACK_EVENTS = 4;

function bangkokDateString(now = new Date()): string {
  return getBangkokDateKey(now) ?? "";
}

function toQueryScope(
  todayCount: number,
  eventCount: number,
): EconomicEventsResponse["queryScope"] {
  if (todayCount > 0) return "today";
  if (eventCount > 0) return "week";
  return "empty";
}

// DB rows only store source facts (name/currency/impact/event_time/forecast/
// previous/actual); mapping back to ForexFactoryEvent lets the DB path reuse
// the exact same normalize/dedupe/sort pipeline as the live-fetch fallback,
// so time-relative fields (isToday/status/dateLabel) are always recomputed
// against request-time "now" rather than going stale in storage.
async function fetchFromDb(): Promise<ForexFactoryEvent[] | null> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await prisma.economicEvent.findMany({
    where: { currency: "USD", event_time: { gte: weekAgo } },
    orderBy: { event_time: "asc" },
  });

  if (rows.length === 0) return null;

  return rows.map((row) => ({
    title: row.name,
    country: row.currency,
    date: row.event_time.toISOString(),
    impact: row.impact,
    forecast: row.forecast ?? undefined,
    previous: row.previous ?? undefined,
    actual: row.actual ?? undefined,
  }));
}

export async function GET(
  req: Request,
): Promise<NextResponse<EconomicEventsResponse>> {
  const { searchParams } = new URL(req.url);
  const isExpanded = searchParams.get("scope") === "expanded";
  const scopeName = isExpanded ? "expanded" : "default";

  const todayBKK = bangkokDateString();
  const now = new Date();
  const nowTime = now.getTime();

  try {
    let raw: ForexFactoryEvent[] | null = null;
    try {
      raw = await fetchFromDb();
    } catch (dbErr) {
      console.error(
        "GET /api/economic-events DB read failed, falling back to live fetch:",
        dbErr,
      );
    }

    if (!raw) {
      raw = await fetchForexFactoryCalendar();
    }

    if (!Array.isArray(raw)) {
      return NextResponse.json({
        events: [],
        date: todayBKK,
        scope: scopeName,
        queryScope: "empty",
      });
    }

    const allEvents = normalizeEvents(raw, todayBKK, nowTime);
    const deduped = dedupeAndSort(allEvents);

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
    return NextResponse.json({
      events: [],
      date: todayBKK,
      scope: scopeName,
      queryScope: "empty",
    });
  }
}
