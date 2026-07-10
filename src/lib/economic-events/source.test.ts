import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeEvents,
  dedupeAndSort,
  mapImpact,
  eventHourBucket,
  fetchForexFactoryCalendar,
} from "./source";

// 2026-06-12T08:00:00+07:00 = Bangkok June 12, 08:00 (past/released today)
const FF_EVENT_FOMC = {
  title: "Federal Funds Rate",
  country: "USD",
  date: "2026-06-12T08:00:00+07:00",
  impact: "High",
  forecast: "5.25%",
  previous: "5.50%",
};

// 2026-06-13T00:00:00+07:00 = Bangkok June 13 (not today, upcoming)
const FF_EVENT_HOLIDAY = {
  title: "US Holiday",
  country: "USD",
  date: "2026-06-13T00:00:00+07:00",
  impact: "Holiday",
  forecast: "",
  previous: "",
};

const FF_EVENT_EU = {
  title: "ECB Rate Decision",
  country: "EUR",
  date: "2026-06-12T11:45:00-04:00",
  impact: "High",
  forecast: "4.25%",
  previous: "4.50%",
};

const FF_EVENT_MEDIUM = {
  title: "US Building Permits",
  country: "USD",
  date: "2026-06-12T12:30:00-04:00",
  impact: "Medium",
  forecast: "1.42M",
  previous: "1.40M",
};

test("mapImpact normalizes upstream impact strings", () => {
  assert.equal(mapImpact("High"), "High");
  assert.equal(mapImpact("high"), "High");
  assert.equal(mapImpact("Medium"), "Medium");
  assert.equal(mapImpact("Low"), "Low");
  assert.equal(mapImpact("Holiday"), "Holiday");
  assert.equal(mapImpact("anything-else"), "Holiday");
});

test("eventHourBucket buckets timestamps to the hour", () => {
  const oneHourMs = 3_600_000;
  assert.equal(eventHourBucket(oneHourMs * 5), 5);
  assert.equal(eventHourBucket(oneHourMs * 5 + 1000), 5);
});

test("normalizeEvents filters to USD high/holiday impact", () => {
  const todayBKK = "2026-06-12";
  const nowTime = new Date("2026-06-12T10:00:00+07:00").getTime();

  const events = normalizeEvents(
    [FF_EVENT_FOMC, FF_EVENT_HOLIDAY, FF_EVENT_EU, FF_EVENT_MEDIUM],
    todayBKK,
    nowTime,
  );

  assert.equal(events.length, 2, "only USD high/holiday events should survive");
  assert.ok(events.every((e) => e.currency === "USD"));
});

test("normalizeEvents marks past events as released and future as upcoming", () => {
  const todayBKK = "2026-06-12";
  const nowTime = new Date("2026-06-12T10:00:00+07:00").getTime();

  const [fomc, holiday] = normalizeEvents([FF_EVENT_FOMC, FF_EVENT_HOLIDAY], todayBKK, nowTime);

  assert.equal(fomc.status, "released");
  assert.equal(fomc.isToday, true);
  assert.equal(holiday.status, "holiday");
  assert.equal(holiday.isToday, false);
});

test("normalizeEvents passes actual value through when present", () => {
  const eventWithActual = {
    title: "Non-Farm Payrolls",
    country: "USD",
    date: "2026-06-06T08:30:00+07:00",
    impact: "High",
    forecast: "180K",
    previous: "175K",
    actual: "272K",
  };

  const events = normalizeEvents([eventWithActual], "2026-06-06", Date.now());
  assert.equal(events[0].actual, "272K");
});

test("normalizeEvents defaults missing actual to null", () => {
  const events = normalizeEvents([FF_EVENT_FOMC], "2026-06-12", Date.now());
  assert.equal(events[0].actual, null);
});

test("dedupeAndSort removes duplicate hour-bucket entries and sorts holidays last", () => {
  const todayBKK = "2026-06-12";
  const nowTime = new Date("2026-06-12T10:00:00+07:00").getTime();

  const events = normalizeEvents([FF_EVENT_HOLIDAY, FF_EVENT_FOMC, FF_EVENT_FOMC], todayBKK, nowTime);
  const deduped = dedupeAndSort(events);

  assert.equal(deduped.length, 2, "duplicate FOMC entries in the same hour bucket should collapse");
  assert.equal(deduped[0].impact, "High", "High impact should come before Holiday");
  assert.equal(deduped[1].impact, "Holiday");
});

test("fetchForexFactoryCalendar falls back to the second mirror on failure", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = (async (url: string) => {
    callCount += 1;
    if (url.includes("nfs.faireconomy.media") && !url.includes("cdn-")) {
      throw new Error("primary mirror down");
    }
    return { ok: true, json: async () => [FF_EVENT_FOMC] } as Response;
  }) as typeof fetch;

  try {
    const result = await fetchForexFactoryCalendar();
    assert.equal(callCount, 2);
    assert.ok(Array.isArray(result));
    assert.equal(result?.[0]?.title, "Federal Funds Rate");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchForexFactoryCalendar returns null when both mirrors fail", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: false } as Response)) as typeof fetch;

  try {
    const result = await fetchForexFactoryCalendar();
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
