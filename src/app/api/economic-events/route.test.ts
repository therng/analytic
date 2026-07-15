import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route";
import { prisma } from "@/lib/prisma";

// These tests mock globalThis.fetch and expect the live-fetch fallback path,
// but GET reads the EconomicEvent table first. Clear it so leftover rows
// from a locally running worker (or a prior test run) don't leak into
// assertions; no-op if DATABASE_URL isn't reachable (matches CI, which has
// no real Postgres service, and already falls back on the DB-read error).
async function clearEconomicEvents() {
  try {
    await prisma.economicEvent.deleteMany({});
  } catch {
    // DB unreachable — route.ts's own fallback handles this at request time.
  }
}

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

const FF_EVENT_NFP = {
  title: "Non-Farm Employment Change",
  country: "USD",
  date: "2026-06-05T08:30:00-04:00",
  impact: "High",
  forecast: "180K",
  previous: "175K",
};

test("economic-events route", async (t) => {
  const originalFetch = globalThis.fetch;
  await clearEconomicEvents();

  await t.test(
    "GET returns default scope with ForexFactory events",
    async () => {
      globalThis.fetch = async () =>
        ({
          ok: true,
          json: async () => [FF_EVENT_FOMC, FF_EVENT_HOLIDAY],
        }) as Response;

      const req = new Request("http://localhost/api/economic-events");
      const res = await GET(req);
      const data = await res.json();

      assert.equal(res.status, 200);
      assert.equal(data.scope, "default");
      assert.ok(Array.isArray(data.events));
      assert.ok(data.events.length > 0);

      const highEvent = data.events.find(
        (e: { impact: string }) => e.impact === "High",
      );
      assert.ok(highEvent, "should have a High impact event");
      assert.equal(highEvent.currency, "USD");
      assert.equal(highEvent.name, "Federal Funds Rate");
      assert.equal(highEvent.forecast, "5.25%");
      assert.equal(highEvent.actual, null, "no actual before release");
    },
  );

  await t.test("GET returns expanded scope", async () => {
    globalThis.fetch = async () =>
      ({
        ok: true,
        json: async () => [FF_EVENT_NFP],
      }) as Response;

    const req = new Request(
      "http://localhost/api/economic-events?scope=expanded",
    );
    const res = await GET(req);
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.scope, "expanded");
    assert.ok(Array.isArray(data.events));
    assert.equal(data.events.length, 1);
    assert.equal(data.events[0].name, "Non-Farm Employment Change");
  });

  await t.test("GET filters out non-USD and medium events", async () => {
    globalThis.fetch = async () =>
      ({
        ok: true,
        json: async () => [FF_EVENT_EU, FF_EVENT_MEDIUM],
      }) as Response;

    const req = new Request(
      "http://localhost/api/economic-events?scope=expanded",
    );
    const res = await GET(req);
    const data = await res.json();

    assert.equal(
      data.events.length,
      0,
      "Non-USD and medium events should be filtered out",
    );
  });

  await t.test("GET returns empty on API failure", async () => {
    globalThis.fetch = async () => ({ ok: false }) as Response;

    const req = new Request("http://localhost/api/economic-events");
    const res = await GET(req);
    const data = await res.json();

    assert.equal(res.status, 200);
    assert.equal(data.events.length, 0);
    assert.equal(data.queryScope, "empty");
  });

  await t.test("GET passes actual value when present", async () => {
    const eventWithActual = {
      title: "Non-Farm Payrolls",
      country: "USD",
      date: "2026-06-06T08:30:00+07:00",
      impact: "High",
      forecast: "180K",
      previous: "175K",
      actual: "272K",
    };

    globalThis.fetch = async () =>
      ({
        ok: true,
        json: async () => [eventWithActual],
      }) as Response;

    const req = new Request(
      "http://localhost/api/economic-events?scope=expanded",
    );
    const res = await GET(req);
    const data = await res.json();

    assert.equal(data.events[0].actual, "272K");
  });

  await t.test("GET holidays sorted after high-impact events", async () => {
    globalThis.fetch = async () =>
      ({
        ok: true,
        json: async () => [FF_EVENT_HOLIDAY, FF_EVENT_FOMC],
      }) as Response;

    const req = new Request(
      "http://localhost/api/economic-events?scope=expanded",
    );
    const res = await GET(req);
    const data = await res.json();

    assert.equal(
      data.events[0].impact,
      "High",
      "High impact should come before Holiday",
    );
    assert.equal(data.events[1].impact, "Holiday");
  });

  globalThis.fetch = originalFetch;
});
