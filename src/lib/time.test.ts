import assert from "node:assert/strict";
import test from "node:test";
import { formatBangkokDateTime, epochSecondsToDate } from "./time";

test("epochSecondsToDate: UTC+0 broker is a pure pass-through", () => {
  const brokerSeconds = Date.UTC(2024, 0, 1, 12, 0, 0) / 1000;
  const result = epochSecondsToDate(brokerSeconds, 0);
  assert.equal(result.toISOString(), "2024-01-01T12:00:00.000Z");
});

test("epochSecondsToDate: subtracts the broker's UTC offset (UTC+3)", () => {
  const brokerLocalSeconds = Date.UTC(2026, 6, 29, 23, 59, 0) / 1000; // broker 23:59
  const result = epochSecondsToDate(brokerLocalSeconds, 180);
  assert.equal(result.toISOString(), "2026-07-29T20:59:00.000Z");
});

test("epochSecondsToDate: broker 00:00 crosses back into the previous UTC day", () => {
  const brokerLocalSeconds = Date.UTC(2026, 6, 30, 0, 0, 0) / 1000; // broker 00:00 on the 30th
  const result = epochSecondsToDate(brokerLocalSeconds, 180);
  assert.equal(result.toISOString(), "2026-07-29T21:00:00.000Z");
});

test("epochSecondsToDate: DST-narrower offset (UTC+2) shifts a smaller amount", () => {
  const brokerLocalSeconds = Date.UTC(2026, 10, 2, 23, 59, 0) / 1000; // broker 23:59, post-DST UTC+2
  const result = epochSecondsToDate(brokerLocalSeconds, 120);
  assert.equal(result.toISOString(), "2026-11-02T21:59:00.000Z");
});

test("epochSecondsToDate: negative broker offset (west of UTC)", () => {
  const brokerLocalSeconds = Date.UTC(2024, 0, 1, 8, 0, 0) / 1000;
  const result = epochSecondsToDate(brokerLocalSeconds, -300);
  assert.equal(result.toISOString(), "2024-01-01T13:00:00.000Z");
});

test("formatBangkokDateTime applies the display timezone exactly once", () => {
  assert.equal(
    formatBangkokDateTime("2026-07-20T01:30:36.000Z"),
    "2026.07.20 08:30:36",
  );
});
