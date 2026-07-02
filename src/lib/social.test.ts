import test from "node:test";
import assert from "node:assert/strict";
import { resolveSparklineVoteTransition } from "./social";

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
