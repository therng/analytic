import { test } from "node:test";
import assert from "node:assert";
import {
  computeLinearRegression,
  computeHoldingSeconds,
  sampleEvenly,
} from "./trade-distributions";

test("computeLinearRegression returns an exact least-squares fit", () => {
  assert.deepEqual(
    computeLinearRegression([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
    ]),
    {
      slope: 2,
      intercept: 1,
      rSquared: 1,
      sampleSize: 3,
      minX: 0,
      maxX: 2,
    },
  );
});

test("computeLinearRegression returns null with fewer than two finite points", () => {
  assert.equal(computeLinearRegression([{ x: 1, y: 2 }]), null);
});

test("computeLinearRegression returns null when x has zero variance", () => {
  assert.equal(
    computeLinearRegression([
      { x: 4, y: 1 },
      { x: 4, y: 2 },
    ]),
    null,
  );
});

test("computeHoldingSeconds uses complete position lifetime", () => {
  assert.equal(
    computeHoldingSeconds(
      new Date("2026-07-17T00:00:00.000Z"),
      new Date("2026-07-17T01:30:00.000Z"),
    ),
    5400,
  );
});

test("computeHoldingSeconds rejects missing, invalid, and reversed timestamps", () => {
  assert.equal(computeHoldingSeconds(null, new Date()), null);
  assert.equal(computeHoldingSeconds(new Date(), null), null);
  assert.equal(
    computeHoldingSeconds(
      new Date("2026-07-17T02:00:00.000Z"),
      new Date("2026-07-17T01:00:00.000Z"),
    ),
    null,
  );
});

test("sampleEvenly returns all items when count is within limit", () => {
  const items = [1, 2, 3, 4, 5];
  const sampled = sampleEvenly(items, 10);
  assert.deepEqual(sampled, items);
});

test("sampleEvenly includes first and last items", () => {
  const items = Array.from({ length: 100 }, (_, i) => i);
  const sampled = sampleEvenly(items, 10);
  assert.equal(sampled[0], items[0]);
  assert.equal(sampled[sampled.length - 1], items[items.length - 1]);
});

test("sampleEvenly is deterministic", () => {
  const items = Array.from({ length: 100 }, (_, i) => i);
  const sample1 = sampleEvenly(items, 10);
  const sample2 = sampleEvenly(items, 10);
  assert.deepEqual(sample1, sample2);
});

test("sampleEvenly handles limit of 1", () => {
  const items = [1, 2, 3, 4, 5];
  const sampled = sampleEvenly(items, 1);
  assert.equal(sampled.length, 1);
  assert.equal(sampled[0], items[items.length - 1]);
});

test("sampleEvenly handles empty array", () => {
  const items: number[] = [];
  const sampled = sampleEvenly(items, 10);
  assert.deepEqual(sampled, []);
});
