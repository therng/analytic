import assert from "node:assert/strict";
import test from "node:test";

import { TIMEFRAME_OPTIONS, displayName } from "./formatters";

test("timeframe options expose every dashboard timeframe in order", () => {
  assert.deepEqual(
    TIMEFRAME_OPTIONS.map((option) => option.value),
    ["1d", "1w", "1m", "3m", "6m", "1y", "all"],
  );
});

test("displayName returns the full sanitized account owner name", () => {
  assert.equal(
    displayName({
      id: "acct-1",
      account_number: "7998410",
      owner_name: "Primary Trading Account",
      currency: "USD",
      server: "Demo",
      status: "Active",
      last_updated: null,
      today_growth_percent: 0,
      week_growth_percent: 0,
      today_net_profit: 0,
      today_net_pips: 0,
      today_trade_count: 0,
      balance: 0,
      equity: 0,
      floating_pl: 0,
      margin: null,
      margin_level: null,
      deposit_load_source: "xauusd_filled_order_volume",
      deposit_load_pct: null,
      deposit_load_margin_used: null,
      xauusd_filled_lots: 0,
    }),
    "Primary Trading Account",
  );
});

test("displayName falls back to the server name when the owner name is missing", () => {
  assert.equal(
    displayName({
      id: "acct-2",
      account_number: "7998411",
      owner_name: null,
      currency: "USD",
      server: "Demo",
      status: "Active",
      last_updated: null,
      today_growth_percent: 0,
      week_growth_percent: 0,
      today_net_profit: 0,
      today_net_pips: 0,
      today_trade_count: 0,
      balance: 0,
      equity: 0,
      floating_pl: 0,
      margin: null,
      margin_level: null,
      deposit_load_source: "xauusd_filled_order_volume",
      deposit_load_pct: null,
      deposit_load_margin_used: null,
      xauusd_filled_lots: 0,
    }),
    "Demo",
  );
});

test("displayName never promotes account number into the primary name", () => {
  assert.equal(
    displayName({
      id: "acct-3",
      account_number: "7998412",
      owner_name: null,
      currency: "USD",
      server: "",
      status: "Active",
      last_updated: null,
      today_growth_percent: 0,
      week_growth_percent: 0,
      today_net_profit: 0,
      today_net_pips: 0,
      today_trade_count: 0,
      balance: 0,
      equity: 0,
      floating_pl: 0,
      margin: null,
      margin_level: null,
      deposit_load_source: "xauusd_filled_order_volume",
      deposit_load_pct: null,
      deposit_load_margin_used: null,
      xauusd_filled_lots: 0,
    }),
    "Account",
  );
});
