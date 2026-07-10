import assert from "node:assert/strict";
import test from "node:test";
import { buildEconomicEventUpsertRow } from "./economic-events-poller";
import { normalizeEvents } from "../lib/economic-events/source";

const NOW = new Date("2026-07-10T12:00:00Z");

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

test("buildEconomicEventUpsertRow: create branch sets poll_attempts to 1", () => {
  const event = makeEvent();
  const row = buildEconomicEventUpsertRow(event, NOW);

  assert.equal(row.create.currency, "USD");
  assert.equal(row.create.name, "Non-Farm Payrolls");
  assert.equal(row.create.impact, "high");
  assert.equal(row.create.forecast, "180K");
  assert.equal(row.create.previous, "175K");
  assert.equal(row.create.actual, null);
  assert.equal(row.create.actual_fetched_at, null);
  assert.equal(row.create.poll_attempts, 1);
});

test("buildEconomicEventUpsertRow: update branch increments poll_attempts and omits actual when absent", () => {
  const event = makeEvent();
  const row = buildEconomicEventUpsertRow(event, NOW);

  assert.deepEqual(row.update.poll_attempts, { increment: 1 });
  assert.equal("actual" in row.update, false, "should not touch actual when incoming value is null");
  assert.equal("actual_fetched_at" in row.update, false);
});

test("buildEconomicEventUpsertRow: update branch sets actual and actual_fetched_at when present", () => {
  const event = makeEvent({ actual: "205K" });
  const row = buildEconomicEventUpsertRow(event, NOW);

  assert.equal(row.update.actual, "205K");
  assert.equal(row.update.actual_fetched_at, NOW);
  assert.equal(row.create.actual, "205K");
  assert.equal(row.create.actual_fetched_at, NOW);
});

test("buildEconomicEventUpsertRow: unique where clause matches currency/name/event_hour_bucket", () => {
  const event = makeEvent();
  const row = buildEconomicEventUpsertRow(event, NOW);

  assert.equal(row.where.currency_name_event_hour_bucket.currency, "USD");
  assert.equal(row.where.currency_name_event_hour_bucket.name, "Non-Farm Payrolls");
  assert.equal(
    row.where.currency_name_event_hour_bucket.event_hour_bucket,
    Math.floor(event.startsAt / 3_600_000),
  );
});
