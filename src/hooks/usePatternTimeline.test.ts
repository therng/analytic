import assert from "node:assert/strict";
import test from "node:test";

import { getPatternStageAtElapsedTime } from "./usePatternTimeline";

test("maps elapsed time to the visual pattern animation stages", () => {
  assert.equal(getPatternStageAtElapsedTime(0), "trend");
  assert.equal(getPatternStageAtElapsedTime(799), "trend");
  assert.equal(getPatternStageAtElapsedTime(800), "formation");
  assert.equal(getPatternStageAtElapsedTime(1599), "formation");
  assert.equal(getPatternStageAtElapsedTime(1600), "pause");
  assert.equal(getPatternStageAtElapsedTime(1999), "pause");
  assert.equal(getPatternStageAtElapsedTime(2000), "outcome");
  assert.equal(getPatternStageAtElapsedTime(2999), "outcome");
  assert.equal(getPatternStageAtElapsedTime(3000), "fade");
  assert.equal(getPatternStageAtElapsedTime(3399), "fade");
  assert.equal(getPatternStageAtElapsedTime(3400), "trend");
});
