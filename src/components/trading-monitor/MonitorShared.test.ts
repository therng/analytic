import assert from "node:assert/strict";
import test from "node:test";

import {
  buildYAxisGridPattern,
  snapValueScale,
} from "@/components/trading-monitor/MonitorShared";

test("snaps the balance chart scale and grid to fixed 50-unit intervals", () => {
  const scale = snapValueScale(
    { minimum: 6_012, maximum: 6_087, range: 75 },
    50,
  );

  assert.deepEqual(scale, {
    minimum: 6_000,
    maximum: 6_100,
    range: 100,
  });

  assert.deepEqual(buildYAxisGridPattern(scale, 320, 112, 50), {
    x: 0,
    y: 6,
    width: 320,
    height: 92,
    spacing: 46,
  });
});
