import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateDealRecord,
  validateOrderRecord,
  validateLiveHash,
  validatePositionsPayload,
  validateOpenPositionCandidate,
} from "./validators";

test("validateDealRecord accepts a well-formed deal", () => {
  const r = validateDealRecord(1001, { ticket: 55, time: 1770000000, volume: 0.1, price: 1.234, profit: 10, swap: -1, commission: -2, fee: 0 }, "1001");
  assert.equal(r.ok, true);
});

test("validateDealRecord rejects login mismatch", () => {
  const r = validateDealRecord(9999, { ticket: 55, time: 1770000000 }, "1001");
  assert.equal(r.ok, false);
});

test("validateDealRecord rejects missing ticket", () => {
  const r = validateDealRecord(1001, { time: 1770000000 }, "1001");
  assert.equal(r.ok, false);
});

test("validateDealRecord rejects non-finite time", () => {
  const r = validateDealRecord(1001, { ticket: 55, time: "not-a-number" }, "1001");
  assert.equal(r.ok, false);
});

test("validateDealRecord rejects non-finite volume when present", () => {
  const r = validateDealRecord(1001, { ticket: 55, time: 1770000000, volume: -1 }, "1001");
  assert.equal(r.ok, false);
});

test("validateOrderRecord accepts an order with only time_setup", () => {
  const r = validateOrderRecord(1001, { ticket: 77, time_setup: 1770000000 }, "1001");
  assert.equal(r.ok, true);
});

test("validateOrderRecord rejects order with neither timestamp", () => {
  const r = validateOrderRecord(1001, { ticket: 77 }, "1001");
  assert.equal(r.ok, false);
});

test("validateOrderRecord rejects malformed sl/tp", () => {
  const r = validateOrderRecord(1001, { ticket: 77, time_setup: 1770000000, sl: "bad" }, "1001");
  assert.equal(r.ok, false);
});

test("validateLiveHash accepts a well-formed hash", () => {
  const r = validateLiveHash({ login: "1001", balance: "1000", equity: "1000", margin: "0", margin_free: "1000", margin_level: "" }, "1001");
  assert.equal(r.ok, true);
});

test("validateLiveHash rejects login mismatch", () => {
  const r = validateLiveHash({ login: "9999", balance: "1000", equity: "1000", margin: "0", margin_free: "1000" }, "1001");
  assert.equal(r.ok, false);
});

test("validateLiveHash rejects null/empty hash", () => {
  assert.equal(validateLiveHash(null, "1001").ok, false);
  assert.equal(validateLiveHash({}, "1001").ok, false);
});

test("validatePositionsPayload parses a valid array", () => {
  const r = validatePositionsPayload("[]");
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.positions, []);
});

test("validatePositionsPayload rejects malformed JSON", () => {
  assert.equal(validatePositionsPayload("{not json").ok, false);
});

test("validatePositionsPayload rejects non-array JSON", () => {
  assert.equal(validatePositionsPayload("{}").ok, false);
});

test("validatePositionsPayload rejects null/missing payload", () => {
  assert.equal(validatePositionsPayload(null).ok, false);
});

test("validateOpenPositionCandidate rejects missing ticket", () => {
  assert.equal(validateOpenPositionCandidate({ volume: 0.1 }).ok, false);
});

test("validateOpenPositionCandidate rejects non-finite profit", () => {
  assert.equal(validateOpenPositionCandidate({ ticket: 1, profit: "bad" }).ok, false);
});

test("validateOpenPositionCandidate rejects unknown position type/side", () => {
  const bad = validateOpenPositionCandidate({ ticket: "1", type: "long" });
  assert.equal(bad.ok, false);

  const good = validateOpenPositionCandidate({ ticket: "1", type: 0 });
  assert.equal(good.ok, true);
});
