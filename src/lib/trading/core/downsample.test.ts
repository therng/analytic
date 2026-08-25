import {
  CURVE_POINT_BUDGET,
  downsampleBy,
  downsampleLTTB,
} from "./downsample";
import assert from "node:assert/strict";
import test from "node:test";

test("downsampleLTTB reduces points correctly", () => {
  const data = Array.from({ length: 100 }, (_, i) => ({
    x: i,
    y: Math.random(),
  }));
  const sampled = downsampleLTTB(data, 10);
  assert.equal(sampled.length, 10);
});

test("downsampleBy caps length, keeps endpoints, and preserves domain objects", () => {
  const events = Array.from({ length: 1000 }, (_, index) => ({
    time: new Date(Date.UTC(2026, 0, 1, 0, index)),
    balance: 1000 + (index % 37 === 0 ? -25 : index / 10),
    eventType: index % 2 === 0 ? "trade" : "deposit",
  }));
  const sampled = downsampleBy(
    events,
    100,
    (event) => event.time.getTime(),
    (event) => event.balance,
  );
  assert.equal(sampled.length, 100);
  assert.equal(sampled[0], events[0]); // first point always kept, same object
  assert.equal(sampled[sampled.length - 1], events[events.length - 1]);
  // Monotonic time order survives sampling.
  for (let index = 1; index < sampled.length; index++) {
    assert.ok(sampled[index].time > sampled[index - 1].time);
  }
});

test("downsampleBy returns the input untouched at or under budget", () => {
  const events = Array.from({ length: 50 }, (_, index) => ({
    time: new Date(Date.UTC(2026, 0, 1, 0, index)),
    balance: index,
  }));
  const same = downsampleBy(
    events,
    480,
    (event) => event.time.getTime(),
    (event) => event.balance,
  );
  assert.equal(same, events);
});

test("curve point budget stays inside the mobile sparkline DOM budget", () => {
  // SparklineChart renders a segment path + a hit-target circle per point,
  // times every mounted card, in one commit — keep the budget far below the
  // point-per-deal / per-60s-sample raw counts (thousands for 1y/all).
  assert.ok(CURVE_POINT_BUDGET > 200, "budget must stay visually smooth");
  assert.ok(CURVE_POINT_BUDGET <= 720, "budget must stay inside DOM budget");
});
