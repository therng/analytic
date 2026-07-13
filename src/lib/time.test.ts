import assert from "node:assert/strict";
import test from "node:test";
import { serverTimeToUtc } from "./time";

test("serverTimeToUtc: UTC+0 broker is a pure pass-through", () => {
  const brokerSeconds = Date.UTC(2024, 0, 1, 12, 0, 0) / 1000;
  const result = serverTimeToUtc(brokerSeconds, 0);
  assert.equal(result.toISOString(), "2024-01-01T12:00:00.000Z");
});

test("serverTimeToUtc: UTC+2 broker subtracts 2 hours to reach true UTC", () => {
  // 2024-06-01 08:30:00 broker server time (UTC+2) is 2024-06-01 06:30:00Z.
  const brokerSeconds = Date.UTC(2024, 5, 1, 8, 30, 0) / 1000;
  const result = serverTimeToUtc(brokerSeconds, 120);
  assert.equal(result.toISOString(), "2024-06-01T06:30:00.000Z");
});

test("serverTimeToUtc: UTC+3 broker subtracts 3 hours to reach true UTC", () => {
  // 2024-01-01 12:00:00 broker server time (UTC+3) is 2024-01-01 09:00:00Z.
  const brokerSeconds = Date.UTC(2024, 0, 1, 12, 0, 0) / 1000;
  const result = serverTimeToUtc(brokerSeconds, 180);
  assert.equal(result.toISOString(), "2024-01-01T09:00:00.000Z");
});

test("serverTimeToUtc: negative offset (west of UTC) adds hours to reach true UTC", () => {
  // A UTC-5 broker server clock reading 08:00 local is 13:00Z.
  const brokerSeconds = Date.UTC(2024, 0, 1, 8, 0, 0) / 1000;
  const result = serverTimeToUtc(brokerSeconds, -300);
  assert.equal(result.toISOString(), "2024-01-01T13:00:00.000Z");
});
