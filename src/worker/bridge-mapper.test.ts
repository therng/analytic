import {
  mapDealPayloadToDeal,
  mapOrderPayloadToOrder,
  mapPositionClosedPayloadToPosition,
} from "./bridge-mapper";
import assert from "node:assert/strict";
import test from "node:test";

test("mapDealPayloadToDeal maps a raw deal to a production Deal row (UTC+0 broker)", () => {
  const row = mapDealPayloadToDeal(
    "acct-1",
    {
      ticket: 555,
      order: 444,
      positionId: 333,
      symbol: "EURUSD",
      type: "sell",
      volume: 0.1,
      price: 1.085,
      commission: -0.5,
      fee: 0,
      swap: -0.2,
      profit: 12.34,
      balanceAfter: 1012.14,
      time: 1751000000,
      comment: "tp",
    },
    0,
  );
  assert.equal(row.dealNo, "555");
  assert.equal(row.direction, "sell");
  assert.equal(String(row.balance), "1012.14");
  assert.ok(row.reportDate instanceof Date);
  assert.equal(
    row.reportDate.toISOString(),
    new Date(1751000000 * 1000).toISOString(),
  );
});

test("mapDealPayloadToDeal preserves MT5 direction when type is blank", () => {
  const row = mapDealPayloadToDeal(
    "acct-1",
    {
      ticket: 556,
      order: 445,
      positionId: 334,
      symbol: "EURUSD",
      type: "",
      direction: "out",
      volume: 0.1,
      price: 1.085,
      commission: -0.5,
      fee: 0,
      swap: -0.2,
      profit: 12.34,
      balance_after: 1012.14,
      time: 1751000000,
      comment: "tp",
    },
    0,
  );
  assert.equal(row.direction, "out");
  assert.equal(String(row.balance), "1012.14");
});

test("mapDealPayloadToDeal subtracts the broker's UTC+3 offset when converting server time", () => {
  // 2024-01-01 12:00:00 broker server time (UTC+3) -> 2024-01-01 09:00:00Z.
  const brokerNoonSeconds = Date.UTC(2024, 0, 1, 12, 0, 0) / 1000;
  const row = mapDealPayloadToDeal(
    "acct-1",
    {
      ticket: 1,
      order: 1,
      positionId: null,
      symbol: "EURUSD",
      type: "buy",
      volume: 0.1,
      price: 1.1,
      commission: 0,
      fee: 0,
      swap: 0,
      profit: 0,
      time: brokerNoonSeconds,
      comment: "",
    },
    180,
  );
  assert.ok(row.time instanceof Date);
  assert.equal((row.time as Date).toISOString(), "2024-01-01T09:00:00.000Z");
});

test("mapOrderPayloadToOrder maps a raw order to a production Order row (UTC+0 broker)", () => {
  const row = mapOrderPayloadToOrder(
    "acct-1",
    {
      ticket: 999,
      positionId: 333,
      symbol: "EURUSD",
      type: "sell",
      state: "FILLED",
      volume: 0.1,
      priceOpen: 1.085,
      sl: 1.09,
      tp: 1.08,
      timeSetup: 1751000000,
      timeDone: 1751000010,
      comment: "",
    },
    0,
  );
  assert.equal(row.orderTicket, "999");
  assert.equal(row.priceCurrent, null);
  assert.ok(row.timeDone instanceof Date);
  assert.equal(
    row.timeDone?.toISOString(),
    new Date(1751000010 * 1000).toISOString(),
  );
});

test("mapOrderPayloadToOrder treats timeDone of 0 as null (order still pending)", () => {
  const row = mapOrderPayloadToOrder(
    "acct-1",
    {
      ticket: 999,
      positionId: null,
      symbol: "EURUSD",
      type: "buy limit",
      state: "PLACED",
      volume: 0.1,
      priceOpen: 1.08,
      sl: 0,
      tp: 0,
      timeSetup: 1751000000,
      timeDone: 0,
      comment: "",
    },
    0,
  );
  assert.equal(row.timeDone, null);
});

test("mapOrderPayloadToOrder subtracts the broker's UTC+2 offset for timeSetup/timeDone", () => {
  // 2024-06-01 08:30:00 broker server time (UTC+2) -> 2024-06-01 06:30:00Z.
  const brokerSeconds = Date.UTC(2024, 5, 1, 8, 30, 0) / 1000;
  const row = mapOrderPayloadToOrder(
    "acct-1",
    {
      ticket: 2,
      positionId: null,
      symbol: "EURUSD",
      type: "buy",
      state: "FILLED",
      volume: 0.1,
      priceOpen: 1.1,
      sl: 0,
      tp: 0,
      timeSetup: brokerSeconds,
      timeDone: brokerSeconds,
      comment: "",
    },
    120,
  );
  assert.ok(row.timeSetup instanceof Date);
  assert.ok(row.timeDone instanceof Date);
  assert.equal(
    (row.timeSetup as Date).toISOString(),
    "2024-06-01T06:30:00.000Z",
  );
  assert.equal(
    (row.timeDone as Date).toISOString(),
    "2024-06-01T06:30:00.000Z",
  );
});

test("mapPositionClosedPayloadToPosition maps an enriched close event to a production Position row (UTC+0 broker)", () => {
  const row = mapPositionClosedPayloadToPosition(
    "acct-1",
    {
      ticket: 777,
      symbol: "XAUUSD",
      positionType: 0,
      volume: 0.5,
      entryPrice: 3300.0,
      exitPrice: 3320.5,
      entryTime: 1750999000,
      exitTime: 1751000000,
      durationSeconds: 1000,
      mae: -15.0,
      mfe: 25.0,
      profit: 20.5,
      commission: -1.0,
      swap: -0.5,
      dealTicket: 555,
      orderTicket: 444,
      comment: "closed by tp",
    },
    0,
  );
  assert.equal(row.positionNo, "777");
  assert.equal(row.sl, null);
  assert.equal(row.tp, null);
  assert.equal(row.pips, null);
  assert.ok(row.reportDate instanceof Date);
  assert.equal(
    row.reportDate.toISOString(),
    new Date(1751000000 * 1000).toISOString(),
  );
});

test("mapPositionClosedPayloadToPosition handles a missing exit deal (null profit/price)", () => {
  const row = mapPositionClosedPayloadToPosition(
    "acct-1",
    {
      ticket: 778,
      symbol: "XAUUSD",
      positionType: 1,
      volume: 0.1,
      entryPrice: 3300.0,
      exitPrice: null,
      entryTime: 1750999000,
      exitTime: 1751000000,
      durationSeconds: 1000,
      mae: -5.0,
      mfe: 2.0,
      profit: null,
      commission: null,
      swap: null,
      dealTicket: null,
      orderTicket: null,
      comment: "",
    },
    0,
  );
  assert.equal(row.closePrice, null);
  assert.equal(row.profit, 0);
});

test("mapPositionClosedPayloadToPosition subtracts the broker's UTC+0 offset as a no-op", () => {
  // A UTC+0 broker server clock already reports true UTC — offset 0 must be a pure pass-through.
  const seconds = Date.UTC(2024, 2, 10, 23, 45, 0) / 1000;
  const row = mapPositionClosedPayloadToPosition(
    "acct-1",
    {
      ticket: 779,
      symbol: "EURUSD",
      positionType: 0,
      volume: 0.1,
      entryPrice: 1.1,
      exitPrice: 1.11,
      entryTime: seconds,
      exitTime: seconds,
      durationSeconds: 0,
      mae: 0,
      mfe: 0,
      profit: 1,
      commission: 0,
      swap: 0,
      dealTicket: null,
      orderTicket: null,
      comment: "",
    },
    0,
  );
  assert.ok(row.closeTime instanceof Date);
  assert.ok(row.openTime instanceof Date);
  assert.equal(
    (row.closeTime as Date).toISOString(),
    "2024-03-10T23:45:00.000Z",
  );
  assert.equal(
    (row.openTime as Date).toISOString(),
    "2024-03-10T23:45:00.000Z",
  );
});

test("mapPositionClosedPayloadToPosition converts entry and exit exactly once for UTC+3 broker", () => {
  const entry = Date.UTC(2024, 0, 1, 12, 0, 0) / 1000;
  const exit = Date.UTC(2024, 0, 1, 13, 0, 0) / 1000;
  const row = mapPositionClosedPayloadToPosition(
    "acct-1",
    {
      ticket: 780,
      symbol: "EURUSD",
      positionType: 0,
      volume: 0.1,
      entryPrice: 1.1,
      exitPrice: 1.11,
      entryTime: entry,
      exitTime: exit,
      durationSeconds: 3600,
      mae: 0,
      mfe: 1,
      profit: 1,
      commission: 0,
      swap: 0,
      dealTicket: 1,
      orderTicket: 2,
      comment: "",
    },
    180,
  );

  assert.equal(
    (row.openTime as Date).toISOString(),
    "2024-01-01T09:00:00.000Z",
  );
  assert.equal(
    (row.closeTime as Date).toISOString(),
    "2024-01-01T10:00:00.000Z",
  );
  assert.equal(
    (row.reportDate as Date).toISOString(),
    "2024-01-01T10:00:00.000Z",
  );
});
