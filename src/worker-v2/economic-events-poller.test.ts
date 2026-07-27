import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEconomicEventUpsertRow,
  economicEventsPollIntervalMs,
} from "./economic-events-poller";
import { normalizeEvents } from "../lib/economic-events/source";

const NOW = new Date("2026-07-10T12:00:00Z");

test("economic poll interval defaults to one hour and validates overrides", () => {
  assert.equal(economicEventsPollIntervalMs({}), 3_600_000);
  assert.equal(
    economicEventsPollIntervalMs({
      WORKER_ECONOMIC_EVENTS_POLL_MS: "7200000",
    }),
    7_200_000,
  );
  assert.throws(
    () =>
      economicEventsPollIntervalMs({
        WORKER_ECONOMIC_EVENTS_POLL_MS: "-1",
      }),
    /positive integer/,
  );
});

function makeEvent(overrides: Record<string, unknown> = {}) {
  const raw = {
    title: "Non-Farm Payrolls",
    country: "USD",
    date: "2026-07-10T08:30:00-04:00",
    impact: "High",
    forecast: "180K",
    previous: "175K",
    ...overrides,
  };
  return normalizeEvents([raw], "2026-07-10", NOW.getTime())[0];
}

test("buildEconomicEventUpsertRow: create branch sets pollAttempts to 1", () => {
  const event = makeEvent();
  const row = buildEconomicEventUpsertRow(event, NOW);

  assert.equal(row.create.currency, "USD");
  assert.equal(row.create.name, "Non-Farm Payrolls");
  assert.equal(row.create.impact, "high");
  assert.equal(row.create.forecast, "180K");
  assert.equal(row.create.previous, "175K");
  assert.equal(row.create.actual, null);
  assert.equal(row.create.actualFetchedAt, null);
  assert.equal(row.create.pollAttempts, 1);
});

test("buildEconomicEventUpsertRow: update branch increments pollAttempts and omits actual when absent", () => {
  const event = makeEvent();
  const row = buildEconomicEventUpsertRow(event, NOW);

  assert.deepEqual(row.update.pollAttempts, { increment: 1 });
  assert.equal(
    "actual" in row.update,
    false,
    "should not touch actual when incoming value is null",
  );
  assert.equal("actualFetchedAt" in row.update, false);
});

test("buildEconomicEventUpsertRow: update branch sets actual and actualFetchedAt when present", () => {
  const event = makeEvent({ actual: "205K" });
  const row = buildEconomicEventUpsertRow(event, NOW);

  assert.equal(row.update.actual, "205K");
  assert.equal(row.update.actualFetchedAt, NOW);
  assert.equal(row.create.actual, "205K");
  assert.equal(row.create.actualFetchedAt, NOW);
});

test("buildEconomicEventUpsertRow: unique where clause matches currency/name/eventHourBucket", () => {
  const event = makeEvent();
  const row = buildEconomicEventUpsertRow(event, NOW);

  assert.equal(row.where.currency_name_eventHourBucket.currency, "USD");
  assert.equal(
    row.where.currency_name_eventHourBucket.name,
    "Non-Farm Payrolls",
  );
  assert.equal(
    row.where.currency_name_eventHourBucket.eventHourBucket,
    Math.floor(event.startsAt / 3_600_000),
  );
});
