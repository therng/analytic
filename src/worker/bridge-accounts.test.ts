import assert from "node:assert/strict";
import test from "node:test";

import { accountNoFromMt5LiveKey } from "./bridge-accounts";

test("accountNoFromMt5LiveKey extracts account number from live key", () => {
  assert.equal(
    accountNoFromMt5LiveKey("mt5:v2:account:7998410:live"),
    "7998410",
  );
});

test("accountNoFromMt5LiveKey ignores non-live MT5 keys", () => {
  assert.equal(
    accountNoFromMt5LiveKey("mt5:v2:account:7998410:positions"),
    null,
  );
  assert.equal(accountNoFromMt5LiveKey("mt5:bridge:heartbeat:7998410"), null);
});

test("accountNoFromMt5LiveKey ignores the retired legacy (pre-bridge_v2) key prefix", () => {
  assert.equal(accountNoFromMt5LiveKey("mt5:account:7998410:live"), null);
});
