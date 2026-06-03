import assert from "node:assert/strict";
import test from "node:test";

import {
  computeAverageHoldHours,
  computeTradeActivityPercent,
  computeTradesPerWeek,
} from "./analytics";

test("computeTradeActivityPercent uses lifetime active calendar days from closed positions", () => {
  const rows = [
    {
      openTime: "2026-03-01T02:00:00.000Z",
      closeTime: "2026-03-03T06:00:00.000Z",
    },
    {
      openTime: "2026-03-10T01:00:00.000Z",
      closeTime: "2026-03-10T05:00:00.000Z",
    },
  ];

  const value = computeTradeActivityPercent(rows);
  assert.equal(value, 40);
});

test("computeTradesPerWeek uses the full lifetime window up to the report date", () => {
  const rows = [
    {
      openTime: "2026-03-01T02:00:00.000Z",
      closeTime: "2026-03-01T06:00:00.000Z",
    },
    {
      openTime: "2026-03-10T01:00:00.000Z",
      closeTime: "2026-03-10T05:00:00.000Z",
    },
  ];

  const value = computeTradesPerWeek(rows, "2026-03-14T12:00:00.000Z");
  assert.equal(value, 1);
});

test("computeAverageHoldHours averages closed position durations from lifetime rows", () => {
  const rows = [
    {
      openTime: "2026-03-01T00:00:00.000Z",
      closeTime: "2026-03-01T12:00:00.000Z",
    },
    {
      openTime: "2026-03-02T00:00:00.000Z",
      closeTime: "2026-03-03T00:00:00.000Z",
    },
  ];

  const value = computeAverageHoldHours(rows);
  assert.equal(value, 18);
});
