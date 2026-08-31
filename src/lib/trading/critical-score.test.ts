import assert from "node:assert/strict";
import test from "node:test";

import { computeCriticalScore } from "./critical-score";

function makeInput(overrides: Partial<Parameters<typeof computeCriticalScore>[0]> = {}) {
  return {
    balance: 10_000,
    equity: 10_000,
    floatingPl: 0,
    marginLevel: 2_000,
    depositLoadPct: 10,
    openPositionCount: 1,
    ...overrides,
  };
}

test("critical score stays at zero when there is no current exposure", () => {
  assert.equal(computeCriticalScore(makeInput({ openPositionCount: 0, floatingPl: -250 })), 0);
});

test("critical score grows with floating loss, margin pressure, and deposit load", () => {
  assert.equal(
    computeCriticalScore(
      makeInput({ floatingPl: -100, marginLevel: 2_000, depositLoadPct: 20 }),
    ),
    7,
  );
  assert.equal(
    computeCriticalScore(
      makeInput({ floatingPl: -250, marginLevel: 500, depositLoadPct: 70 }),
    ),
    53,
  );
});

test("critical score reaches 100 at the calibrated emergency point", () => {
  assert.equal(
    computeCriticalScore(
      makeInput({ floatingPl: -500, marginLevel: 100, depositLoadPct: 100 }),
    ),
    100,
  );
});

test("missing risk inputs contribute zero instead of creating invalid scores", () => {
  assert.equal(
    computeCriticalScore(
      makeInput({ equity: Number.NaN, floatingPl: Number.NaN, marginLevel: null, depositLoadPct: null }),
    ),
    0,
  );
});
