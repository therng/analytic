import assert from "node:assert/strict";
import test from "node:test";
import { formatBangkokDateTime, serverTimeToUtc } from "./time";

test("serverTimeToUtc: UTC+0 broker is a pure pass-through", () => {
  const brokerSeconds = Date.UTC(2024, 0, 1, 12, 0, 0) / 1000;
  const result = serverTimeToUtc(brokerSeconds, 0);
  assert.equal(result.toISOString(), "2024-01-01T12:00:00.000Z");
});

test("serverTimeToUtc: broker offset does not alter MetaTrader UTC epoch", () => {
  const mt5EpochSeconds = Date.UTC(2024, 5, 1, 8, 30, 0) / 1000;
  const result = serverTimeToUtc(mt5EpochSeconds, 120);
  assert.equal(result.toISOString(), "2024-06-01T08:30:00.000Z");
});

test("serverTimeToUtc: preserves MetaTrader Python UTC epochs", () => {
  const mt5EpochSeconds = Date.UTC(2026, 6, 20, 1, 30, 36) / 1000;
  const result = serverTimeToUtc(mt5EpochSeconds, 180);
  assert.equal(result.toISOString(), "2026-07-20T01:30:36.000Z");
});

test("serverTimeToUtc: negative broker offset does not alter MetaTrader UTC epoch", () => {
  const mt5EpochSeconds = Date.UTC(2024, 0, 1, 8, 0, 0) / 1000;
  const result = serverTimeToUtc(mt5EpochSeconds, -300);
  assert.equal(result.toISOString(), "2024-01-01T08:00:00.000Z");
});

test("formatBangkokDateTime applies the display timezone exactly once", () => {
  assert.equal(
    formatBangkokDateTime("2026-07-20T01:30:36.000Z"),
    "2026.07.20 08:30:36",
  );
});
