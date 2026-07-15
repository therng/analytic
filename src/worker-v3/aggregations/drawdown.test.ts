import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { computeDrawdown, type BalancePoint } from "./drawdown";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

function curve(balances: number[]): BalancePoint[] {
  // Deterministic ascending times; epoch 0,1,2,... seconds.
  return balances.map((b, i) => ({
    time: new Date(i * 1000),
    balanceAfter: D(b),
  }));
}

// Mandatory fixture — spec §8. Exact decimal assertions, no internal rounding.
// Initial deposit 5000; curve 5000, 6000, 4000, 8000, 5500.
test("spec §8 drawdown fixture: absolute, maximal (money), relative (percent)", () => {
  const points = curve([5000, 6000, 4000, 8000, 5500]);
  const result = computeDrawdown(points, D(5000));

  // Absolute drawdown: 5000 - 4000 = 1000.
  assert.ok(result.absolute.equals(D(1000)), `absolute=${result.absolute}`);

  // Maximal MONETARY drawdown: 8000 - 5500 = 2500, percentage 2500/8000*100 = 31.25.
  assert.ok(result.maximal, "maximal span present");
  assert.ok(
    result.maximal!.money.equals(D(2500)),
    `maximal.money=${result.maximal!.money}`,
  );
  assert.ok(result.maximal!.peakBalance.equals(D(8000)));
  assert.ok(result.maximal!.troughBalance.equals(D(5500)));
  assert.ok(
    result.maximal!.percent!.equals(D("31.25")),
    `maximal.percent=${result.maximal!.percent}`,
  );

  // Relative (greatest PERCENT) drawdown: (6000-4000)/6000*100 = 33.333...%,
  // corresponding monetary value 2000. Distinct span from the maximal-money one.
  assert.ok(result.relative, "relative span present");
  assert.ok(
    result.relative!.money.equals(D(2000)),
    `relative.money=${result.relative!.money}`,
  );
  assert.ok(result.relative!.peakBalance.equals(D(6000)));
  assert.ok(result.relative!.troughBalance.equals(D(4000)));
  // Exact: computed the same way, no pre-rounding.
  assert.ok(
    result.relative!.percent!.equals(D(2000).dividedBy(6000).times(100)),
    `relative.percent=${result.relative!.percent}`,
  );

  // The two spans genuinely differ (proves separate tracking is required).
  assert.ok(!result.maximal!.peakBalance.equals(result.relative!.peakBalance));
});

test("empty curve yields zero absolute and null spans", () => {
  const result = computeDrawdown([], D(1000));
  assert.ok(result.absolute.equals(D(0)));
  assert.equal(result.maximal, null);
  assert.equal(result.relative, null);
});

test("monotonically rising curve has no drawdown", () => {
  const result = computeDrawdown(curve([1000, 1100, 1200]), D(1000));
  assert.ok(result.absolute.equals(D(0)));
  assert.equal(result.maximal, null);
  assert.equal(result.relative, null);
});

test("zero/negative peak: percent is null but money still tracked", () => {
  // Peak 0 then trough -500: money drawdown 500, percent undefined (peak <= 0).
  const points: BalancePoint[] = [
    { time: new Date(0), balanceAfter: D(0) },
    { time: new Date(1000), balanceAfter: D(-500) },
  ];
  const result = computeDrawdown(points, D(0));
  assert.ok(
    result.maximal,
    "money drawdown recorded even with non-positive peak",
  );
  assert.ok(result.maximal!.money.equals(D(500)));
  assert.equal(result.maximal!.percent, null);
  assert.equal(
    result.relative,
    null,
    "no positive-peak drawdown, relative is null",
  );
});
