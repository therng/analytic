import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRealtime24HourBalanceCurve } from "./balance-curve-24h";

test("mid-day deposit without balanceAfter still steps the curve", () => {
  const dayStart = new Date("2026-07-28T17:00:00.000Z"); // 00:00 Bangkok
  const reportTime = new Date("2026-07-28T20:00:00.000Z");

  const deals = [
    {
      time: new Date("2026-07-28T18:00:00.000Z"),
      type: "balance",
      comment: "Deposit",
      profit: 500,
      commission: 0,
      swap: 0,
      balance: null,
    },
    {
      time: new Date("2026-07-28T19:00:00.000Z"),
      type: "sell",
      direction: "in",
      symbol: "XAUUSD",
      profit: 20,
      commission: -1,
      swap: 0,
      balance: null,
    },
  ];

  const points = buildRealtime24HourBalanceCurve(
    deals as any,
    reportTime,
    519, // endingBalance = 0 (baseline) + 500 deposit + 19 trade net
  );

  const depositPoint = points.find((p) => p.eventDelta === 500);
  assert.ok(depositPoint, "deposit delta must appear as a curve point");
  assert.equal(depositPoint!.balance, 500);

  const tradePoint = points.find((p) => p.eventType === "sell");
  assert.ok(tradePoint);
  assert.equal(tradePoint!.balance, 519);
});

test("pre-day deposit without balanceAfter carries into the baseline", () => {
  const reportTime = new Date("2026-07-28T20:00:00.000Z");

  const deals = [
    {
      time: new Date("2026-07-27T10:00:00.000Z"), // prior day
      type: "balance",
      comment: "Deposit",
      profit: 1000,
      commission: 0,
      swap: 0,
      balance: null,
    },
  ];

  const points = buildRealtime24HourBalanceCurve(deals as any, reportTime, 1000);
  assert.equal(points[0].balance, 1000);
});
