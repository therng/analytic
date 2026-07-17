import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveSparklineVoteTransition,
  resolveBurstCoordinates,
  resolveCenteredPickerLeft,
  normalizeInfiniteScrollLeft,
  resolvePickerTop,
} from "./social";

test("resolveSparklineVoteTransition votes when nothing is active", () => {
  assert.equal(resolveSparklineVoteTransition(null, "👍").nextActive, "👍");
});

test("resolveSparklineVoteTransition unvotes when tapping the active emoji", () => {
  assert.equal(resolveSparklineVoteTransition("👍", "👍").nextActive, null);
});

test("resolveSparklineVoteTransition switches to a new emoji, replacing the active one", () => {
  assert.equal(resolveSparklineVoteTransition("👍", "🎉").nextActive, "🎉");
});

test("resolveBurstCoordinates uses pointer coordinates for a real click (detail >= 1)", () => {
  const result = resolveBurstCoordinates(1, 120, 340, {
    left: 0,
    top: 0,
    width: 40,
    height: 40,
  });
  assert.deepEqual(result, { x: 120, y: 340 });
});

test("resolveBurstCoordinates uses the button's center for a keyboard/programmatic click (detail === 0)", () => {
  const result = resolveBurstCoordinates(0, 0, 0, {
    left: 100,
    top: 200,
    width: 40,
    height: 40,
  });
  assert.deepEqual(result, { x: 120, y: 220 });
});

test("resolveCenteredPickerLeft centers the reaction bar and clamps it to the viewport inset", () => {
  assert.equal(resolveCenteredPickerLeft(100, 300, 240, 800), 130);
  assert.equal(resolveCenteredPickerLeft(0, 390, 374, 390), 8);
  assert.equal(resolveCenteredPickerLeft(700, 100, 200, 800), 592);
});

test("resolvePickerTop keeps the reaction bar inside a short landscape viewport", () => {
  assert.equal(resolvePickerTop(418, 54, 844), 382);
  assert.equal(resolvePickerTop(389, 54, 390), 328);
});

test("normalizeInfiniteScrollLeft keeps a three-copy carousel inside its middle loop", () => {
  const segmentWidth = 440;

  assert.equal(normalizeInfiniteScrollLeft(440, segmentWidth), 440);
  assert.equal(normalizeInfiniteScrollLeft(100, segmentWidth), 540);
  assert.equal(normalizeInfiniteScrollLeft(700, segmentWidth), 260);
  assert.equal(normalizeInfiniteScrollLeft(1200, segmentWidth), 320);
  assert.equal(normalizeInfiniteScrollLeft(80, 0), 80);
});
