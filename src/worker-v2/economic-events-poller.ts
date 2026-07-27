import { prisma } from "../lib/prisma";
import { getBangkokDateKey } from "../lib/time";
import {
  type DerivedEconomicEvent,
  fetchForexFactoryCalendar,
  normalizeEvents,
  eventHourBucket,
} from "../lib/economic-events/source";
import { abortableDelay } from "./background-loop";

// Upstream (faireconomy) only regenerates the export file once per hour and
// rate-limits (429) more frequent requests, so the default must not undercut
// that — confirmed live: polling every 10 min triggered a 429 within one
// session.
export const DEFAULT_ECONOMIC_EVENTS_POLL_MS = 3_600_000;
const SOURCE = "faireconomy";

export type EconomicPollStats = {
  fetched: boolean;
  upserted: number;
  failed: number;
};

type EconomicEventDb = {
  economicEvent: {
    upsert(args: unknown): Promise<unknown>;
  };
};

export function economicEventsPollIntervalMs(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): number {
  const raw = env.WORKER_ECONOMIC_EVENTS_POLL_MS;
  if (raw == null || raw.trim() === "") {
    return DEFAULT_ECONOMIC_EVENTS_POLL_MS;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("WORKER_ECONOMIC_EVENTS_POLL_MS must be a positive integer");
  }
  return value;
}

export function buildEconomicEventUpsertRow(
  event: DerivedEconomicEvent,
  now: Date,
) {
  const hasActual = event.actual != null;

  return {
    where: {
      currency_name_eventHourBucket: {
        currency: event.currency,
        name: event.name,
        eventHourBucket: eventHourBucket(event.startsAt),
      },
    },
    create: {
      source: SOURCE,
      currency: event.currency,
      name: event.name,
      eventTime: new Date(event.startsAt),
      eventHourBucket: eventHourBucket(event.startsAt),
      impact: event.impact.toLowerCase(),
      forecast: event.forecast,
      previous: event.previous,
      actual: event.actual,
      actualFetchedAt: hasActual ? now : null,
      lastPolledAt: now,
      pollAttempts: 1,
    },
    update: {
      forecast: event.forecast,
      previous: event.previous,
      impact: event.impact.toLowerCase(),
      eventTime: new Date(event.startsAt),
      lastPolledAt: now,
      pollAttempts: { increment: 1 },
      // Never overwrite a captured actual with null, and only stamp
      // actualFetchedAt the first time a non-null actual appears.
      ...(hasActual ? { actual: event.actual, actualFetchedAt: now } : {}),
    },
  };
}

export async function pollEconomicEventsOnce(
  db: EconomicEventDb = prisma as unknown as EconomicEventDb,
): Promise<EconomicPollStats> {
  const raw = await fetchForexFactoryCalendar();
  if (!Array.isArray(raw)) {
    console.error(
      "[economic-events-poller] upstream fetch failed, skipping pass",
    );
    return { fetched: false, upserted: 0, failed: 0 };
  }

  const now = new Date();
  const todayBKK = getBangkokDateKey(now) ?? "";
  const events = normalizeEvents(raw, todayBKK, now.getTime());

  const stats: EconomicPollStats = {
    fetched: true,
    upserted: 0,
    failed: 0,
  };
  for (const event of events) {
    try {
      const row = buildEconomicEventUpsertRow(event, now);
      await db.economicEvent.upsert(row);
      stats.upserted += 1;
    } catch (error) {
      stats.failed += 1;
      console.error(
        `[economic-events-poller] Failed to upsert event "${event.name}":`,
        error,
      );
    }
  }
  return stats;
}

export async function runEconomicEventsLoop(opts: {
  intervalMs: number;
  signal: AbortSignal;
  onCycle?: (stats: EconomicPollStats) => void;
  db?: EconomicEventDb;
}): Promise<void> {
  while (!opts.signal.aborted) {
    try {
      const stats = await pollEconomicEventsOnce(opts.db);
      opts.onCycle?.(stats);
    } catch (error) {
      console.error("[economic-events-poller] poll pass failed:", error);
      opts.onCycle?.({ fetched: false, upserted: 0, failed: 1 });
    }
    await abortableDelay(opts.intervalMs, opts.signal);
  }
}
