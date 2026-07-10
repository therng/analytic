import { prisma } from "../lib/prisma";
import { getBangkokDateKey } from "../lib/time";
import {
  type DerivedEconomicEvent,
  fetchForexFactoryCalendar,
  normalizeEvents,
  eventHourBucket,
} from "../lib/economic-events/source";

// Upstream (faireconomy) only regenerates the export file once per hour and
// rate-limits (429) more frequent requests, so the default must not undercut
// that — confirmed live: polling every 10 min triggered a 429 within one
// session.
const POLL_INTERVAL_MS = Number.parseInt(process.env.WORKER_ECONOMIC_EVENTS_POLL_MS || "3600000", 10);
const SOURCE = "faireconomy";

export function buildEconomicEventUpsertRow(event: DerivedEconomicEvent, now: Date) {
  const hasActual = event.actual != null;

  return {
    where: {
      currency_name_event_hour_bucket: {
        currency: event.currency,
        name: event.name,
        event_hour_bucket: eventHourBucket(event.startsAt),
      },
    },
    create: {
      source: SOURCE,
      currency: event.currency,
      name: event.name,
      event_time: new Date(event.startsAt),
      event_hour_bucket: eventHourBucket(event.startsAt),
      impact: event.impact.toLowerCase(),
      forecast: event.forecast,
      previous: event.previous,
      actual: event.actual,
      actual_fetched_at: hasActual ? now : null,
      last_polled_at: now,
      poll_attempts: 1,
    },
    update: {
      forecast: event.forecast,
      previous: event.previous,
      impact: event.impact.toLowerCase(),
      event_time: new Date(event.startsAt),
      last_polled_at: now,
      poll_attempts: { increment: 1 },
      // Never overwrite a captured actual with null, and only stamp
      // actual_fetched_at the first time a non-null actual appears.
      ...(hasActual ? { actual: event.actual, actual_fetched_at: now } : {}),
    },
  };
}

export async function pollEconomicEventsOnce() {
  const raw = await fetchForexFactoryCalendar();
  if (!Array.isArray(raw)) {
    console.error("[economic-events-poller] upstream fetch failed, skipping pass");
    return;
  }

  const now = new Date();
  const todayBKK = getBangkokDateKey(now) ?? "";
  const events = normalizeEvents(raw, todayBKK, now.getTime());

  for (const event of events) {
    try {
      const row = buildEconomicEventUpsertRow(event, now);
      await prisma.economicEvent.upsert(row);
    } catch (error) {
      console.error(`[economic-events-poller] Failed to upsert event "${event.name}":`, error);
    }
  }
}

export function startEconomicEventsPoller() {
  let stopped = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleNext = () => {
    if (stopped) return;
    pollTimer = setTimeout(runPollPass, POLL_INTERVAL_MS);
  };

  // Self-scheduling loop: the next pass is only scheduled once the current
  // one has finished (success or failure), so slow passes never overlap.
  function runPollPass() {
    pollEconomicEventsOnce()
      .catch((error) => console.error("[economic-events-poller] poll pass failed:", error))
      .finally(scheduleNext);
  }

  runPollPass();

  return () => {
    stopped = true;
    clearTimeout(pollTimer);
  };
}
