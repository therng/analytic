import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { toDecimal, toDecimalOrZero, isFiniteNumeric } from "./decimal.ts";

test("toDecimal converts numeric string safely", () => {
  const d = toDecimal(12.5);
  assert.ok(d instanceof Prisma.Decimal);
  assert.equal(d?.toString(), "12.5");
});

test("toDecimal returns null for null/undefined/empty/non-finite", () => {
  assert.equal(toDecimal(null), null);
  assert.equal(toDecimal(undefined), null);
  assert.equal(toDecimal(""), null);
  assert.equal(toDecimal(NaN), null);
  assert.equal(toDecimal(Infinity), null);
});

test("toDecimalOrZero returns zero Decimal for missing values", () => {
  assert.equal(toDecimalOrZero(null).toString(), "0");
  assert.equal(toDecimalOrZero(3).toString(), "3");
});

test("isFiniteNumeric rejects non-numeric and accepts numeric-looking strings", () => {
  assert.equal(isFiniteNumeric(5), true);
  assert.equal(isFiniteNumeric("5.5"), true);
  assert.equal(isFiniteNumeric("abc"), false);
  assert.equal(isFiniteNumeric(null), false);
  assert.equal(isFiniteNumeric(undefined), false);
  assert.equal(isFiniteNumeric(""), false);
  assert.equal(isFiniteNumeric(Infinity), false);
});
