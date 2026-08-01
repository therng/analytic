import assert from "node:assert/strict";
import test from "node:test";

import {
  accountNoFromMt5LiveKey,
  DEFAULT_BROKER_UTC_OFFSET_MINUTES,
} from "./bridge-accounts";

test("new bridge accounts default to broker UTC+3", () => {
  assert.equal(DEFAULT_BROKER_UTC_OFFSET_MINUTES, 180);
});

test("accountNoFromMt5LiveKey extracts account number from the native live key", () => {
  assert.equal(
    accountNoFromMt5LiveKey("mt5:account:{7998410}:live"),
    "7998410",
  );
});

test("accountNoFromMt5LiveKey ignores non-live native keys", () => {
  assert.equal(
    accountNoFromMt5LiveKey("mt5:account:{7998410}:stream:history"),
    null,
  );
  assert.equal(accountNoFromMt5LiveKey("mt5:account:{7998410}:lease"), null);
});

test("accountNoFromMt5LiveKey ignores retired bridge_v2 and un-hash-tagged variants", () => {
  assert.equal(accountNoFromMt5LiveKey("mt5:v2:account:7998410:live"), null);
  // Missing the {login} hash tag entirely — never a valid key under any
  // scheme this codebase has used, must not parse.
  assert.equal(accountNoFromMt5LiveKey("mt5:account:7998410:live"), null);
});
