import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTodayNetPips,
  getAccountAnchorDate,
  getAccountListMetricsSince,
  getReportDayWindow,
  getSinceDate,
  getTodayNetPips,
  serializeAccountBundle,
  sortAccountListItems,
} from "./account-data";
import type { SerializedAccount } from "./types";

function makeAccount(overrides: Partial<SerializedAccount>): SerializedAccount {
  return {
    id: overrides.id ?? "account-1",
    account_number: overrides.account_number ?? "1001",
    owner_name: overrides.owner_name ?? null,
    currency: overrides.currency ?? "USD",
    server: overrides.server ?? "Demo",
    status: overrides.status ?? "Active",
    last_updated: overrides.last_updated ?? null,
    today_growth_percent: overrides.today_growth_percent ?? 0,
    week_growth_percent: overrides.week_growth_percent ?? 0,
    today_net_profit: overrides.today_net_profit ?? 0,
    today_net_pips: overrides.today_net_pips ?? 0,
    balance: overrides.balance ?? 0,
    equity: overrides.equity ?? 0,
    floating_pl: overrides.floating_pl ?? 0,
    margin: overrides.margin ?? null,
    margin_level: overrides.margin_level ?? null,
    deposit_load_source: "xauusd_filled_order_volume",
    deposit_load_pct: overrides.deposit_load_pct ?? null,
    deposit_load_margin_used: overrides.deposit_load_margin_used ?? null,
    xauusd_filled_lots: overrides.xauusd_filled_lots ?? 0,
  };
}

test("sortAccountListItems prefers higher 1D growth before pips, balance, and account number", () => {
  const sorted = sortAccountListItems([
    makeAccount({ id: "a", account_number: "1002", today_growth_percent: 11 }),
    makeAccount({ id: "b", account_number: "1001", today_growth_percent: 24 }),
    makeAccount({ id: "c", account_number: "1003", today_growth_percent: 17 }),
  ]);

  assert.deepEqual(
    sorted.map((account) => account.id),
    ["b", "c", "a"],
  );
});

test("sortAccountListItems uses pips descending when growth ties", () => {
  const sorted = sortAccountListItems([
    makeAccount({ id: "a", today_growth_percent: 9, today_net_pips: 12 }),
    makeAccount({ id: "b", today_growth_percent: 9, today_net_pips: 18 }),
  ]);

  assert.deepEqual(
    sorted.map((account) => account.id),
    ["b", "a"],
  );
});

test("sortAccountListItems uses balance when growth and pips tie, regardless of profit", () => {
  const sorted = sortAccountListItems([
    makeAccount({
      id: "a",
      today_growth_percent: 9,
      today_net_pips: 12,
      today_net_profit: 200,
      balance: 2000,
    }),
    makeAccount({
      id: "b",
      today_growth_percent: 9,
      today_net_pips: 12,
      today_net_profit: 50,
      balance: 4000,
    }),
  ]);

  assert.deepEqual(
    sorted.map((account) => account.id),
    ["b", "a"],
  );
});

test("sortAccountListItems uses balance descending when growth and pips tie", () => {
  const sorted = sortAccountListItems([
    makeAccount({
      id: "a",
      today_growth_percent: 9,
      today_net_pips: 12,
      today_net_profit: 100,
      balance: 2000,
    }),
    makeAccount({
      id: "b",
      today_growth_percent: 9,
      today_net_pips: 12,
      today_net_profit: 100,
      balance: 4000,
    }),
  ]);

  assert.deepEqual(
    sorted.map((account) => account.id),
    ["b", "a"],
  );
});

test("sortAccountListItems uses account number ascending when all metrics tie", () => {
  const sorted = sortAccountListItems([
    makeAccount({
      id: "a",
      account_number: "1010",
      today_growth_percent: 9,
      today_net_pips: 12,
      today_net_profit: 100,
      balance: 3000,
    }),
    makeAccount({
      id: "b",
      account_number: "1002",
      today_growth_percent: 9,
      today_net_pips: 12,
      today_net_profit: 100,
      balance: 3000,
    }),
    makeAccount({
      id: "c",
      account_number: "1001",
      today_growth_percent: 9,
      today_net_pips: 12,
      today_net_profit: 100,
      balance: 3000,
    }),
  ]);

  assert.deepEqual(
    sorted.map((account) => account.account_number),
    ["1001", "1002", "1010"],
  );
});

test("applyTodayNetPips defaults accounts without today's positions to zero", () => {
  const hydrated = applyTodayNetPips(
    [
      makeAccount({ id: "a", account_number: "1001", balance: 1000 }),
      makeAccount({ id: "b", account_number: "1002", balance: 2000 }),
    ],
    new Map([["b", 18.5]]),
  );

  assert.equal(hydrated[0]?.today_net_pips, 0);
  assert.equal(hydrated[1]?.today_net_pips, 18.5);
});

test("getReportDayWindow anchors 1D metrics to the account report day instead of current time", () => {
  // 2026-04-20T08:00:00Z is 2026-04-20 15:00 Bangkok (UTC+7); Bangkok
  // midnight for that day is 2026-04-19T17:00:00Z (real UTC, no table-time
  // indirection — Deal/Position timestamps are true UTC after the
  // broker-timezone refactor).
  const anchorDate = new Date("2026-04-20T08:00:00.000Z");
  const { start, end } = getReportDayWindow(anchorDate);

  assert.equal(start.toISOString(), "2026-04-19T17:00:00.000Z");
  assert.equal(end.toISOString(), "2026-04-20T17:00:00.000Z");
});

test("getAccountListMetricsSince keeps the previous Bangkok day plus the rolling week", () => {
  assert.equal(
    getAccountListMetricsSince(new Date("2026-04-20T08:00:00.000Z")).toISOString(),
    "2026-04-12T17:00:00.000Z",
  );
});

test("getTodayNetPips sums only positions closed within the anchored report day window", () => {
  const anchorDate = new Date("2026-04-20T08:00:00.000Z");

  const pips = getTodayNetPips(
    [
      { closeTime: "2026-04-19T16:59:00.000Z", pips: 5 },
      { closeTime: "2026-04-19T17:00:00.000Z", pips: 12.5 },
      { closeTime: "2026-04-20T16:59:00.000Z", pips: -2.5 },
      { closeTime: "2026-04-20T17:00:00.000Z", pips: 99 },
    ],
    anchorDate,
  );

  assert.equal(pips, 10);
});

test("serializeAccountBundle uses the latest report timestamp as the 1D metric anchor", () => {
  const serialized = serializeAccountBundle({
    latestSnapshot: {
      reportDate: new Date("2026-04-20T08:00:00.000Z"),
      balance: 1100,
      equity: 1115,
      floatingPl: 15,
      margin: 100,
      marginLevel: 200,
    },
    account: {
      id: "account-1",
      accountNo: "1001",
      accountName: "Primary",
      currency: "USD",
      serverName: "Demo",
      reportDate: new Date("2026-04-20T08:00:00.000Z"),
      deals: [
        {
          time: new Date("2026-04-19T16:00:00.000Z"),
          dealNo: "deposit",
          type: "balance",
          comment: "deposit",
          profit: 1000,
          commission: 0,
          swap: 0,
          balance: 1000,
        },
        {
          time: new Date("2026-04-19T22:00:00.000Z"),
          dealNo: "trade-1",
          type: "buy",
          comment: null,
          profit: 100,
          commission: 0,
          swap: 0,
          balance: 1100,
        },
      ],
      openPositions: [
        {
          reportDate: new Date("2026-04-20T08:00:00.000Z"),
          profit: 15,
        },
      ],
      positions: [
        {
          closeTime: new Date("2026-04-19T20:30:00.000Z"),
          pips: 18.5,
        },
      ],
    },
  } as any);

  assert.ok(serialized);
  assert.ok(Math.abs((serialized?.today_growth_percent ?? 0) - 10) < 0.000001);
  assert.equal(serialized?.today_net_profit, 100);
  assert.equal(serialized?.today_net_pips, 18.5);
});

test("getAccountAnchorDate advances when a closed position is newer than the snapshot", () => {
  const anchor = getAccountAnchorDate({
    latestSnapshot: {
      reportDate: new Date("2026-07-19T12:00:00.000Z"),
    },
    account: {
      reportDate: new Date("2026-07-19T12:00:00.000Z"),
      openPositions: [],
      deals: [
        {
          time: new Date("2026-07-20T01:00:00.000Z"),
        },
      ],
      positions: [
        {
          closeTime: new Date("2026-07-20T02:00:00.000Z"),
        },
      ],
    },
  } as any);

  assert.equal(anchor.toISOString(), "2026-07-20T02:00:00.000Z");
});

test("newest persisted trade is inside every dashboard timeframe window", () => {
  const latestClose = new Date("2026-07-20T02:00:00.000Z");
  const anchor = getAccountAnchorDate({
    latestSnapshot: {
      reportDate: new Date("2026-07-19T12:00:00.000Z"),
    },
    account: {
      reportDate: new Date("2026-07-19T12:00:00.000Z"),
      openPositions: [],
      deals: [{ time: new Date("2026-07-20T01:00:00.000Z") }],
      positions: [{ closeTime: latestClose }],
    },
  } as any);

  for (const timeframe of ["1d", "1w", "1m", "3m", "6m", "1y", "all"] as const) {
    const since = getSinceDate(timeframe, anchor);
    assert.ok(
      since === null || latestClose.getTime() >= since.getTime(),
      `${timeframe} must include the latest persisted close`,
    );
  }
});

test("serializeAccountBundle normalizes margin level values to numbers", () => {
  const serialized = serializeAccountBundle({
    latestSnapshot: {
      reportDate: new Date("2026-04-20T08:00:00.000Z"),
      balance: 1100,
      equity: 1115,
      floatingPl: 15,
      margin: 100,
      marginLevel: "250.75",
    },
    account: {
      id: "account-1",
      accountNo: "1001",
      accountName: "Primary",
      currency: "USD",
      serverName: "Demo",
      reportDate: new Date("2026-04-20T08:00:00.000Z"),
      deals: [],
      openPositions: [],
      positions: [],
    },
  } as any);

  assert.equal(serialized?.margin_level, 250.75);
});

test("serializeAccountBundle derives deposit load from filled XAUUSD order volume and balance", () => {
  const serialized = serializeAccountBundle({
    latestSnapshot: {
      reportDate: new Date("2026-04-20T08:00:00.000Z"),
      balance: 10000,
      equity: 10000,
      floatingPl: 0,
      // Broker margin would give 90% — the product metric must ignore it.
      margin: 9000,
      marginLevel: 111,
    },
    account: {
      id: "account-1",
      accountNo: "1001",
      accountName: "Primary",
      currency: "USD",
      serverName: "Demo",
      marginMode: "retail_hedging",
      reportDate: new Date("2026-04-20T08:00:00.000Z"),
      deals: [],
      openPositions: [],
      orders: [
        { symbol: "XAUUSD", volume: 1, state: "filled" },
        { symbol: "XAUUSD.m", volume: 0.5, state: "filled" },
        { symbol: "EURUSD", volume: 3, state: "filled" },
        { symbol: "XAUUSD", volume: 10, state: "placed" },
      ],
      positions: [],
    },
  } as any);

  assert.equal(serialized?.deposit_load_source, "xauusd_filled_order_volume");
  assert.equal(serialized?.xauusd_filled_lots, 1.5);
  // 1.5 lots x 410.3 = 615.45 margin used -> 6.1545% of 10,000 balance.
  assert.ok(
    Math.abs((serialized?.deposit_load_margin_used ?? 0) - 615.45) < 1e-9,
  );
  assert.ok(Math.abs((serialized?.deposit_load_pct ?? 0) - 6.1545) < 1e-9);
  // Broker margin stays on its own untouched fields.
  assert.equal(serialized?.margin, 9000);
  assert.equal(serialized?.margin_level, 111);
});

test("serializeAccountBundle reports null deposit load before a XAUUSD order is filled", () => {
  const serialized = serializeAccountBundle({
    latestSnapshot: {
      reportDate: new Date("2026-04-20T08:00:00.000Z"),
      balance: 10000,
      equity: 10000,
      floatingPl: 0,
      margin: 500,
      marginLevel: 2000,
    },
    account: {
      id: "account-1",
      accountNo: "1001",
      currency: "USD",
      serverName: "Demo",
      reportDate: new Date("2026-04-20T08:00:00.000Z"),
      deals: [],
      openPositions: [{ symbol: "EURUSD", volume: 3, type: "buy", profit: 0 }],
      orders: [
        { symbol: "XAUUSD", volume: 1, state: "placed" },
        { symbol: "EURUSD", volume: 3, state: "filled" },
      ],
      positions: [],
    },
  } as any);

  assert.equal(serialized?.xauusd_filled_lots, 0);
  assert.equal(serialized?.deposit_load_margin_used, 0);
  assert.equal(serialized?.deposit_load_pct, null);
});
