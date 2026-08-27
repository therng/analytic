import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeMt5PositionTimes } from "./redis-mt5";

test("normalizeMt5PositionTimes subtracts the broker's live-clock UTC offset", () => {
  const brokerLocalNoon = Date.UTC(2026, 6, 20, 12, 0, 0) / 1000;
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
        openTime: brokerLocalNoon,
      },
    ],
    180,
  );

  assert.equal(position?.openTime, brokerLocalNoon - 180 * 60);
});

test("normalizeMt5PositionTimes emits null openTime when the broker offset is unconfigured", () => {
  const [position] = normalizeMt5PositionTimes(
    [
      {
        ticket: 2,
        symbol: "XAUUSD",
        type: 1,
        volume: 0.5,
        openPrice: 2300,
        currentPrice: 2310,
        sl: 0,
        tp: 0,
        profit: 50,
        swap: 0,
        comment: "",
        openTime: 1_800_000_000,
      },
    ],
    null,
  );

  // Row survives (openCount KPI + floating P/L depend on presence); only
  // the timestamp is unknowable and renders "-" downstream.
  assert.equal(position?.openTime, null);
  assert.equal(position?.ticket, 2);
});

test("live API does not reject UTC positions when broker offset is unset", async () => {
  const source = await readFile(
    new URL("../app/api/accounts/[id]/live/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /brokerUtcOffsetMinutes === null/);
});

test("live API does not default an unconfigured broker offset to zero", async () => {
  const source = await readFile(
    new URL("../app/api/accounts/[id]/live/route.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /brokerUtcOffsetMinutes\s*\?\?/);
});
