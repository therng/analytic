import assert from "node:assert/strict";
import test from "node:test";
import {
  lockPullToRefresh,
  unlockPullToRefresh,
  isPullToRefreshLocked,
} from "./pull-to-refresh-lock";

test("isPullToRefreshLocked reflects lock/unlock calls", () => {
  assert.equal(isPullToRefreshLocked(), false);
  lockPullToRefresh();
  assert.equal(isPullToRefreshLocked(), true);
  unlockPullToRefresh();
  assert.equal(isPullToRefreshLocked(), false);
});

test("overlapping locks require matching unlocks (counter, not boolean)", () => {
  lockPullToRefresh();
  lockPullToRefresh();
  assert.equal(isPullToRefreshLocked(), true);
  unlockPullToRefresh();
  assert.equal(isPullToRefreshLocked(), true);
  unlockPullToRefresh();
  assert.equal(isPullToRefreshLocked(), false);
});

test("unlock never goes negative on an unmatched call", () => {
  unlockPullToRefresh();
  unlockPullToRefresh();
  assert.equal(isPullToRefreshLocked(), false);
  lockPullToRefresh();
  assert.equal(isPullToRefreshLocked(), true);
  unlockPullToRefresh();
  assert.equal(isPullToRefreshLocked(), false);
});
