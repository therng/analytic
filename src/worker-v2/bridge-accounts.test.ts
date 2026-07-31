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
    accountNoFromMt5LiveKey("mt5n:v1:live:{7998410}"),
    "7998410",
  );
});

test("accountNoFromMt5LiveKey ignores non-live native keys", () => {
  assert.equal(
    accountNoFromMt5LiveKey("mt5n:v1:stream:history:{7998410}"),
    null,
  );
  assert.equal(accountNoFromMt5LiveKey("mt5n:v1:lease:{7998410}"), null);
});

test("accountNoFromMt5LiveKey ignores retired bridge_v2/legacy key prefixes", () => {
  assert.equal(accountNoFromMt5LiveKey("mt5:v2:account:7998410:live"), null);
  assert.equal(accountNoFromMt5LiveKey("mt5:account:7998410:live"), null);
});
