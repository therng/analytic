import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBangkokDateTime,
  epochSecondsToDate,
  liveEpochSecondsToDate,
} from "./time";

test("epochSecondsToDate: UTC+0 broker is a pure pass-through", () => {
  const brokerSeconds = Date.UTC(2024, 0, 1, 12, 0, 0) / 1000;
  const result = epochSecondsToDate(brokerSeconds, 0);
  assert.equal(result.toISOString(), "2024-01-01T12:00:00.000Z");
});

test("epochSecondsToDate: broker offset does not alter MetaTrader UTC epoch", () => {
  const mt5EpochSeconds = Date.UTC(2024, 5, 1, 8, 30, 0) / 1000;
  const result = epochSecondsToDate(mt5EpochSeconds, 120);
  assert.equal(result.toISOString(), "2024-06-01T08:30:00.000Z");
});

test("epochSecondsToDate: preserves MetaTrader Python UTC epochs", () => {
  const mt5EpochSeconds = Date.UTC(2026, 6, 20, 1, 30, 36) / 1000;
  const result = epochSecondsToDate(mt5EpochSeconds, 180);
  assert.equal(result.toISOString(), "2026-07-20T01:30:36.000Z");
});

test("epochSecondsToDate: negative broker offset does not alter MetaTrader UTC epoch", () => {
  const mt5EpochSeconds = Date.UTC(2024, 0, 1, 8, 0, 0) / 1000;
  const result = epochSecondsToDate(mt5EpochSeconds, -300);
  assert.equal(result.toISOString(), "2024-01-01T08:00:00.000Z");
});

test("formatBangkokDateTime applies the display timezone exactly once", () => {
  assert.equal(
    formatBangkokDateTime("2026-07-20T01:30:36.000Z"),
    "2026.07.20 08:30:36",
  );
});

test("liveEpochSecondsToDate: subtracts the broker's live-clock UTC offset (UTC+3)", () => {
  const brokerLocalSeconds = Date.UTC(2026, 6, 29, 23, 59, 0) / 1000; // broker 23:59
  const result = liveEpochSecondsToDate(brokerLocalSeconds, 180);
  assert.equal(result.toISOString(), "2026-07-29T20:59:00.000Z");
});

test("liveEpochSecondsToDate: UTC+0 broker is a pure pass-through", () => {
  const brokerLocalSeconds = Date.UTC(2026, 0, 1, 0, 0, 0) / 1000; // broker 00:00
  const result = liveEpochSecondsToDate(brokerLocalSeconds, 0);
  assert.equal(result.toISOString(), "2026-01-01T00:00:00.000Z");
});

test("liveEpochSecondsToDate: broker 00:00 crosses back into the previous UTC day", () => {
  const brokerLocalSeconds = Date.UTC(2026, 6, 30, 0, 0, 0) / 1000; // broker 00:00 on the 30th
  const result = liveEpochSecondsToDate(brokerLocalSeconds, 180);
  assert.equal(result.toISOString(), "2026-07-29T21:00:00.000Z");
});

test("liveEpochSecondsToDate: DST-narrower offset (UTC+2) shifts a smaller amount", () => {
  const brokerLocalSeconds = Date.UTC(2026, 10, 2, 23, 59, 0) / 1000; // broker 23:59, post-DST UTC+2
  const result = liveEpochSecondsToDate(brokerLocalSeconds, 120);
  assert.equal(result.toISOString(), "2026-11-02T21:59:00.000Z");
});

test("epochSecondsToDate (history path) stays a pass-through — verified correct for Deal/Order/Position", () => {
  const historyEpochSeconds = Date.UTC(2026, 6, 29, 23, 59, 0) / 1000;
  const result = epochSecondsToDate(historyEpochSeconds, 180);
  assert.equal(result.toISOString(), "2026-07-29T23:59:00.000Z");
});
