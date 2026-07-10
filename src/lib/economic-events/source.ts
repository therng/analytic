import { getBangkokDateParts } from "@/lib/time";

export type EconomicEvent = {
  id: string;
  name: string;
  currency: string;
  impact: "High" | "Medium" | "Low" | "Holiday";
  time: string; // HH:MM Bangkok time, or "" for all-day
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  dateLabel: string;
  isToday: boolean;
  status: "upcoming" | "released" | "holiday";
};

export type DerivedEconomicEvent = EconomicEvent & {
  startsAt: number;
};

export type ForexFactoryEvent = {
  title?: string;
  country?: string; // currency code: "USD", "EUR", etc.
  date?: string; // ISO with timezone offset: "2026-06-12T14:00:00-04:00"
  impact?: string; // "High", "Medium", "Low", "Holiday"
  forecast?: string;
  previous?: string;
  actual?: string; // populated after the event is released
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatEventDateLabel(isoDate: string): string {
  const parts = getBangkokDateParts(isoDate);
  if (!parts) return "";
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[parts.month - 1]} ${parts.day}`;
}

export function toEventStatus(
  isHoliday: boolean,
  isValidDate: boolean,
  eventTime: number,
  nowTime: number,
): EconomicEvent["status"] {
  if (isHoliday) return "holiday";
  if (isValidDate && eventTime > nowTime) return "upcoming";
  return "released";
}

export function mapImpact(impact: string): EconomicEvent["impact"] {
  const imp = impact.toLowerCase();
  if (imp === "high") return "High";
  if (imp === "medium") return "Medium";
  if (imp === "low") return "Low";
  return "Holiday";
}

export function eventHourBucket(startsAt: number): number {
  return Math.floor(startsAt / 3_600_000);
}

export function dedupeKey(ev: { currency: string; name: string; startsAt: number }): string {
  return `${ev.currency}|${ev.name}|${eventHourBucket(ev.startsAt)}`;
}

export async function fetchForexFactoryCalendar(): Promise<ForexFactoryEvent[] | null> {
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

export function normalizeEvents(
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

export function dedupeAndSort(events: DerivedEconomicEvent[]): DerivedEconomicEvent[] {
  const seen = new Set<string>();
  const deduped = events.filter((ev) => {
    const key = dedupeKey(ev);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => {
    if (a.impact === "Holiday" && b.impact !== "Holiday") return 1;
    if (a.impact !== "Holiday" && b.impact === "Holiday") return -1;
    return a.startsAt - b.startsAt;
  });

  return deduped;
}
