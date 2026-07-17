import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveSparklineVoteTransition,
  resolveBurstCoordinates,
  resolveCenteredPickerLeft,
  resolvePickerTop,
} from "./social";

test("resolveSparklineVoteTransition allows a first vote and a later unvote", () => {
  const vote = resolveSparklineVoteTransition(false, "vote");
  assert.equal(vote.allowed, true);
  assert.equal(vote.nextVoted, true);
  assert.equal(vote.countDelta, 1);

  const unvote = resolveSparklineVoteTransition(true, "unvote");
  assert.equal(unvote.allowed, true);
  assert.equal(unvote.nextVoted, false);
  assert.equal(unvote.countDelta, -1);
});

test("resolveSparklineVoteTransition blocks duplicate vote and invalid unvote", () => {
  const duplicateVote = resolveSparklineVoteTransition(true, "vote");
  assert.equal(duplicateVote.allowed, false);
  assert.equal(duplicateVote.nextVoted, true);
  assert.equal(duplicateVote.countDelta, 0);

  const invalidUnvote = resolveSparklineVoteTransition(false, "unvote");
  assert.equal(invalidUnvote.allowed, false);
  assert.equal(invalidUnvote.nextVoted, false);
  assert.equal(invalidUnvote.countDelta, 0);
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
