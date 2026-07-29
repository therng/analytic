import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapDealToPrisma,
  computeDealNetProfit,
  mapOrderToPrisma,
  mapLiveToAccountSnapshot,
  mapPositionToOpenPosition,
  mapLiveAccountingSystem,
} from "./mappers";

const OFFSET = 180; // +3h broker offset, arbitrary for the test

test("mapDealToPrisma maps raw MT5 deal fields", () => {
  const input = mapDealToPrisma(
    "acc1",
    {
      ticket: 55,
      time: 1770000000,
      symbol: "EURUSD",
      type: 0,
      volume: 0.1,
      price: 1.234,
      commission: -2,
      fee: 0,
      swap: -1,
      profit: 10,
      comment: "x",
      order: 900,
      position_id: 800,
    },
    OFFSET,
  );
  assert.equal(input.dealNo, "55");
  assert.equal(input.symbol, "EURUSD");
  assert.equal(input.orderId, "900");
  assert.equal(input.positionId, "800");
  assert.equal(input.commission?.toString(), "-2");
  assert.ok(input.time instanceof Date);
  assert.equal(
    (input.time as Date).toISOString(),
    new Date(1770000000 * 1000 - OFFSET * 60 * 1000).toISOString(),
  );
});

test("computeDealNetProfit uses Decimal arithmetic across profit+swap+commission, excludes fee", () => {
  const net = computeDealNetProfit({
    profit: 10,
    swap: -1,
    commission: -2,
    fee: 0.5,
  });
  assert.equal(net.toString(), "7");
});

test("computeDealNetProfit defaults missing fields to zero", () => {
  const net = computeDealNetProfit({ profit: 10 });
  assert.equal(net.toString(), "10");
});

test("mapOrderToPrisma preserves S/L, T/P and position reference", () => {
  const input = mapOrderToPrisma(
    "acc1",
    {
      ticket: 77,
      symbol: "EURUSD",
      type: 1,
      state: "PLACED",
      volume_current: 0.2,
      price_open: 1.1,
      price_current: 1.11,
      sl: 1.05,
      tp: 1.2,
      time_setup: 1770000000,
      position_id: 800,
    },
    OFFSET,
  );
  assert.equal(input.orderTicket, "77");
  assert.equal(input.positionId, "800");
  assert.equal(input.sl?.toString(), "1.05");
  assert.equal(input.tp?.toString(), "1.2");
  assert.ok(input.timeSetup instanceof Date);
  assert.equal(
    (input.timeSetup as Date).toISOString(),
    new Date(1770000000 * 1000 - OFFSET * 60 * 1000).toISOString(),
  );
  assert.equal(input.timeDone, null);
});

test("mapOrderToPrisma uses volume_initial for a fully-filled order, not the drained volume_current", () => {
  const input = mapOrderToPrisma(
    "acc1",
    {
      ticket: 78,
      symbol: "XAUUSD",
      type: 1,
      state: 4, // filled
      volume_initial: 0.1,
      volume_current: 0.0, // fully filled -> nothing remaining, but not the order's size
      time_setup: 1770000000,
    },
    OFFSET,
  );
  assert.equal(input.volume, 0.1);
});

test("mapLiveToAccountSnapshot maps live hash to snapshot fields", () => {
  const input = mapLiveToAccountSnapshot(
    "acc1",
    {
      login: "1001",
      balance: "1000",
      equity: "990",
      margin: "10",
      margin_free: "980",
      margin_level: "9900",
      profit: "-10",
      credit: "0",
    },
    1770000000,
  );
  assert.equal(input.balance.toString(), "1000");
  assert.equal(input.freeMargin.toString(), "980");
  assert.equal(input.marginLevel, 9900);
  assert.ok(input.reportDate instanceof Date);
});

test("mapPositionToOpenPosition maps live position fields", () => {
  const reportDate = new Date();
  const input = mapPositionToOpenPosition(
    "acc1",
    {
      ticket: 321,
      symbol: "GBPUSD",
      type: 0,
      volume: 0.5,
      price_open: 1.25,
      price_current: 1.26,
      sl: 1.2,
      tp: 1.3,
      swap: -0.5,
      profit: 5,
      magic: 42,
      time: 1770000000,
    },
    OFFSET,
    reportDate,
  );
  assert.equal(input.positionNo, "321");
  assert.equal(input.marketPrice.toString(), "1.26");
  assert.equal(input.magic, 42);
  assert.equal(input.reportDate, reportDate);
  assert.equal(
    (input.openTime as Date).toISOString(),
    new Date(1770000000 * 1000 - OFFSET * 60 * 1000).toISOString(),
  );
});

test("mapDealToPrisma decodes type and direction, leaves unknown type as deal_type_<raw>", () => {
  const mapped = mapDealToPrisma(
    "acct-1",
    { ticket: "1", time: 1700000000, type: 0, entry: 1 },
    0,
  );
  assert.equal(mapped.type, "buy");
  assert.equal(mapped.direction, "out");

  const unknown = mapDealToPrisma(
    "acct-1",
    { ticket: "2", time: 1700000000, type: 999 },
    0,
  );
  assert.equal(unknown.type, "deal_type_999");
  assert.equal(unknown.direction, null);
});

test("mapDealToPrisma decodes magic and reason, defaults to null when absent", () => {
  const mapped = mapDealToPrisma(
    "acct-1",
    { ticket: "1", time: 1700000000, type: 0, magic: 12345, reason: 5 },
    0,
  );
  assert.equal(mapped.magic, 12345);
  assert.equal(mapped.reason, "tp");

  const absent = mapDealToPrisma(
    "acct-1",
    { ticket: "2", time: 1700000000, type: 0 },
    0,
  );
  assert.equal(absent.magic, null);
  assert.equal(absent.reason, null);
});

test("mapOrderToPrisma decodes magic, reason, price_stoplimit and time_expiration", () => {
  const mapped = mapOrderToPrisma(
    "acct-1",
    {
      ticket: "1",
      time_setup: 1700000000,
      type: 6,
      magic: 777,
      reason: 3,
      price_stoplimit: 1.15,
      time_expiration: 1770000000,
    },
    0,
  );
  assert.equal(mapped.magic, 777);
  assert.equal(mapped.reason, "expert");
  assert.equal(mapped.priceStoplimit?.toString(), "1.15");
  assert.ok(mapped.timeExpiration instanceof Date);
});

test("mapOrderToPrisma treats time_expiration 0 as unset, not an epoch", () => {
  const mapped = mapOrderToPrisma(
    "acct-1",
    { ticket: "1", time_setup: 1700000000, type: 0, time_expiration: 0 },
    0,
  );
  assert.equal(mapped.timeExpiration, null);
});

test("mapOrderToPrisma decodes type", () => {
  const mapped = mapOrderToPrisma(
    "acct-1",
    { ticket: "1", time_setup: 1700000000, type: 4 },
    0,
  );
  assert.equal(mapped.type, "buy_stop");
});

test("mapOrderToPrisma decodes state, fill policy, and order time type", () => {
  const mapped = mapOrderToPrisma(
    "acct-1",
    {
      ticket: "1",
      time_setup: 1700000000,
      type: 0,
      state: 4,
      type_filling: 0,
      type_time: 1,
    },
    0,
  );
  assert.equal(mapped.state, "filled");
  assert.equal(mapped.fillPolicy, "fok");
  assert.equal(mapped.orderTimeType, "day");
});

test("mapOrderToPrisma defaults fill policy and order time type to null when absent", () => {
  const mapped = mapOrderToPrisma(
    "acct-1",
    { ticket: "1", time_setup: 1700000000, type: 0 },
    0,
  );
  assert.equal(mapped.fillPolicy, null);
  assert.equal(mapped.orderTimeType, null);
});

test("mapLiveAccountingSystem decodes margin_mode and trade_mode from the live hash", () => {
  const mapped = mapLiveAccountingSystem({
    margin_mode: "2",
    trade_mode: "0",
  } as Record<string, string>);
  assert.equal(mapped.marginMode, "retail_hedging");
  assert.equal(mapped.tradeMode, "demo");
});

test("mapPositionToOpenPosition persists decoded buy/sell side", () => {
  const mapped = mapPositionToOpenPosition(
    "acct-1",
    { ticket: "1", symbol: "EURUSD", type: 1 },
    0,
    new Date(),
  );
  assert.equal(mapped.type, "sell");
});
