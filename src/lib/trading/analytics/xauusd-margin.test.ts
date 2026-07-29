import assert from "node:assert/strict";
import test from "node:test";

import {
  XAUUSD_MARGIN_PER_LOT,
  depositLoadByXauusdFilledOrderVolume,
  depositLoadByXauusdVolume,
  depositLoadFromXauusdFilledOrderVolume,
  depositLoadFromXauusdVolume,
  marginUsedFromXauusdFilledOrderVolume,
  marginUsedFromXauusdVolume,
} from "./xauusd-margin";

test("estimates deposit load from filled XAUUSD order volume and balance", () => {
  const result = depositLoadByXauusdFilledOrderVolume({
    balance: 10_000,
    orders: [
      { symbol: "XAUUSD", volumeLots: 1, state: "filled" },
      { symbol: "XAUUSDm", volumeLots: 0.5, state: "FILLED" },
      { symbol: "EURUSD", volumeLots: 3, state: "filled" },
      { symbol: "XAUUSD", volumeLots: 10, state: "placed" },
    ],
  });

  assert.equal(result.xauusdLots, 1.5);
  assert.ok(Math.abs(result.marginUsedUsd - 615.45) < 1e-12);
  assert.equal(result.balanceUsd, 10_000);
  assert.ok(Math.abs((result.depositLoadPct ?? 0) - 6.1545) < 1e-12);
});

test("does not start deposit load before a XAUUSD order is filled", () => {
  const result = depositLoadByXauusdFilledOrderVolume({
    balance: 10_000,
    orders: [
      { symbol: "XAUUSD", volumeLots: 1, state: "placed" },
      { symbol: "EURUSD", volumeLots: 3, state: "filled" },
    ],
  });

  assert.equal(result.xauusdLots, 0);
  assert.equal(result.marginUsedUsd, 0);
  assert.equal(result.depositLoadPct, null);
});

test("supports filled XAUUSD margin and percentage helpers", () => {
  assert.equal(
    marginUsedFromXauusdFilledOrderVolume([
      { symbol: "XAUUSD.pro", volumeLots: 2, state: "filled" },
    ]),
    2 * XAUUSD_MARGIN_PER_LOT,
  );

  const load = depositLoadFromXauusdFilledOrderVolume({
    balance: 1_000,
    orders: [{ symbol: "XAUUSD", volumeLots: 0.15, state: "filled" }],
  });
  assert.ok(Math.abs((load ?? 0) - 6.1545) < 1e-12);
});

test("estimates gross XAUUSD margin and deposit load", () => {
  const result = depositLoadByXauusdVolume({
    equity: 1_000,
    openLegs: [
      { symbol: "XAUUSDm", volumeLots: 0.1, side: "buy" },
      { symbol: "XAUUSD", volumeLots: 0.05, side: "buy" },
      { symbol: "EURUSD", volumeLots: 10, side: "buy" },
    ],
    mode: "gross",
  });

  assert.ok(Math.abs(result.xauusdLots - 0.15) < 1e-12);
  assert.ok(Math.abs(result.marginUsedUsd - 61.545) < 1e-12);
  assert.equal(result.equityUsd, 1_000);
  assert.ok(Math.abs((result.depositLoadPct ?? 0) - 6.1545) < 1e-12);
});

test("nets opposing XAUUSD legs while retaining suffix matching", () => {
  const margin = marginUsedFromXauusdVolume(
    [
      { symbol: " xau/usd.", volumeLots: 0.1, side: "buy" },
      { symbol: "XAUUSD.pro", volumeLots: 0.05, side: "sell" },
    ],
    "net",
  );

  assert.equal(margin, 0.05 * XAUUSD_MARGIN_PER_LOT);
});

test("ignores non-XAUUSD and invalid volumes", () => {
  assert.equal(
    marginUsedFromXauusdVolume([
      { symbol: "GBPUSD", volumeLots: 1 },
      { symbol: "XAUUSD", volumeLots: 0 },
      { symbol: "XAUUSD", volumeLots: Number.NaN },
      { symbol: "XAUUSD", volumeLots: -0.1 },
    ]),
    0,
  );
});

test("returns null load when equity is not positive", () => {
  const result = depositLoadByXauusdVolume({
    equity: 0,
    openLegs: [{ symbol: "XAUUSD", volumeLots: 1 }],
    mode: "gross",
  });

  assert.equal(result.marginUsedUsd, XAUUSD_MARGIN_PER_LOT);
  assert.equal(result.depositLoadPct, null);
});

test("supports a broker-specific per-lot override", () => {
  assert.equal(
    marginUsedFromXauusdVolume(
      [{ symbol: "XAUUSD", volumeLots: 2 }],
      "gross",
      { symbol: "XAUUSD", marginPerLotUsd: 500 },
    ),
    1_000,
  );
});

test("provides the percentage-only convenience helper", () => {
  const load = depositLoadFromXauusdVolume({
    equity: 1_000,
    legs: [{ symbol: "XAUUSD", volumeLots: 0.15 }],
  });
  assert.ok(Math.abs((load ?? 0) - 6.1545) < 1e-12);
});
