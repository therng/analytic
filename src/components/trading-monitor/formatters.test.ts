import assert from "node:assert/strict";
import test from "node:test";

import { displayName } from "./formatters";

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
      balance: 0,
      equity: 0,
      floating_pl: 0,
      margin: null,
      margin_level: null,
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
      balance: 0,
      equity: 0,
      floating_pl: 0,
      margin: null,
      margin_level: null,
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
      balance: 0,
      equity: 0,
      floating_pl: 0,
      margin: null,
      margin_level: null,
    }),
    "Account",
  );
});
