import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeMt5PositionTimes } from "./redis-mt5";

test("normalizeMt5PositionTimes preserves MetaTrader Python UTC epochs", () => {
  const mt5Noon = Date.UTC(2026, 6, 20, 12, 0, 0) / 1000;
  const [position] = normalizeMt5PositionTimes(
    [
      {
        ticket: 1,
        symbol: "EURUSD",
        type: 0,
        volume: 0.1,
        openPrice: 1.1,
        currentPrice: 1.2,
        sl: 0,
        tp: 0,
        profit: 10,
        swap: 0,
        comment: "",
        openTime: mt5Noon,
      },
    ],
    180,
  );

  assert.equal(position?.openTime, mt5Noon);
});

test("live API does not reject UTC positions when broker offset is unset", async () => {
  const source = await readFile(
    new URL("../app/api/accounts/[id]/live/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /brokerUtcOffsetMinutes === null/);
});
