import assert from "node:assert/strict";
import test from "node:test";

import { absDrawdownTone, formatAbsCompactNumber, formatCompactSignedNumber } from "./formatters";

test("formatCompactSignedNumber renders compact signed values", () => {
  assert.equal(formatCompactSignedNumber(12.3, 1), "+12.3");
  assert.equal(formatCompactSignedNumber(12345, 1), "+12.3K");
  assert.equal(formatCompactSignedNumber(-12345, 1), "-12.3K");
});

test("formatAbsCompactNumber renders only negative values as compact magnitudes", () => {
  assert.equal(formatAbsCompactNumber(-8500, 1), "8.5K");
  assert.equal(formatAbsCompactNumber(0, 1), "0");
  assert.equal(formatAbsCompactNumber(8500, 1), "0");
});

test("absDrawdownTone marks negative ABS values as negative and non-negative values as neutral", () => {
  assert.equal(absDrawdownTone(-1), "negative");
  assert.equal(absDrawdownTone(0), "neutral");
  assert.equal(absDrawdownTone(5), "neutral");
});
