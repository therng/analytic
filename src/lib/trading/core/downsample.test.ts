import { downsampleLTTB } from "./downsample";
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
