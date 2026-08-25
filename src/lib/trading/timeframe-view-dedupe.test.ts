import { test } from "node:test";
import assert from "node:assert";

import {
  getOrBuildTimeframeView,
  getOrBuildTimeframeViews,
  type AccountPreaggregatedBundle,
  type CachedTimeframeViews,
  type TimeframeBuildFn,
} from "@/lib/trading/preaggregated-cache";
import { buildContractSource } from "@/lib/trading/view-contract-source";
import type { Timeframe } from "@/lib/trading/types";

// The default persister writes to Redis — keep tests off the network.
const noopPersist = () => {};

function fakeView(marker: string): CachedTimeframeViews {
  return { marker } as unknown as CachedTimeframeViews;
}

function makeBundle(): AccountPreaggregatedBundle {
  return {
    accountId: "test-account",
    aggregateVersionKey: "agg-1",
    equityVersionKey: "eq-1",
    lastCheckedAt: Date.now(),
    source: buildContractSource(),
    timeframes: {},
  };
}

test("concurrent getOrBuildTimeframeView calls share one build", async () => {
  const bundle = makeBundle();
  let builds = 0;

  const buildViews: TimeframeBuildFn = async () => {
    builds += 1;
    // Simulate a slow build so both callers are genuinely in flight.
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { "1d": fakeView(`build-${builds}`) };
  };

  const [first, second] = await Promise.all([
    getOrBuildTimeframeView(bundle, "1d", buildViews, noopPersist),
    getOrBuildTimeframeView(bundle, "1d", buildViews, noopPersist),
  ]);

  assert.equal(builds, 1, "both callers must share a single build");
  assert.equal(first, second, "both callers must receive the same view object");
});

test("a settled view is served from the memo without rebuilding", async () => {
  const bundle = makeBundle();
  let builds = 0;
  const buildViews: TimeframeBuildFn = async () => {
    builds += 1;
    return { "1w": fakeView("w") };
  };

  const first = await getOrBuildTimeframeView(bundle, "1w", buildViews, noopPersist);
  const second = await getOrBuildTimeframeView(bundle, "1w", buildViews, noopPersist);

  assert.equal(builds, 1);
  assert.equal(first, second);
});

test("a failed build is cleared so a later request can retry", async () => {
  const bundle = makeBundle();
  let attempts = 0;

  const buildViews: TimeframeBuildFn = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("boom");
    return { "1m": fakeView("ok") };
  };

  await assert.rejects(
    () => getOrBuildTimeframeView(bundle, "1m", buildViews, noopPersist),
    /boom/,
  );

  const retried = await getOrBuildTimeframeView(
    bundle,
    "1m" as Timeframe,
    buildViews,
    noopPersist,
  );
  assert.equal(attempts, 2, "the rejection must not be memoized");
  assert.deepEqual(
    (retried as unknown as { marker: string }).marker,
    "ok",
  );
});

test("batched builds share one buildViews call and memoize each timeframe", async () => {
  const bundle = makeBundle();
  const seenSourceIds = new Set<string>();
  let buildCalls = 0;

  const buildViews: TimeframeBuildFn = async (_source, timeframes, sourceId) => {
    buildCalls += 1;
    if (sourceId) seenSourceIds.add(sourceId);
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Object.fromEntries(
      timeframes.map((tf) => [tf, fakeView(`batch-${tf}`)]),
    );
  };

  const [one, week, month] = await getOrBuildTimeframeViews(
    bundle,
    ["1d", "1w", "1m"],
    buildViews,
    noopPersist,
  );

  assert.equal(buildCalls, 1, "all missing timeframes must share one build call");
  assert.deepEqual(seenSourceIds.size, 1, "the batch must carry one sourceId");
  assert.equal((one as unknown as { marker: string }).marker, "batch-1d");
  assert.equal((week as unknown as { marker: string }).marker, "batch-1w");
  assert.equal((month as unknown as { marker: string }).marker, "batch-1m");

  // Already-warm timeframes are served from the memo without a new build.
  await getOrBuildTimeframeViews(bundle, ["1d"], buildViews, noopPersist);
  assert.equal(buildCalls, 1);
});

test("a failed batch clears only the slots it still owns", async () => {
  const bundle = makeBundle();
  let attempts = 0;

  const buildViews: TimeframeBuildFn = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("batch boom");
    return { "1d": fakeView("ok"), all: fakeView("ok-all") };
  };

  await assert.rejects(
    () =>
      getOrBuildTimeframeViews(bundle, ["1d", "all"], buildViews, noopPersist),
    /batch boom/,
  );

  const [first] = await getOrBuildTimeframeViews(
    bundle,
    ["1d", "all"],
    buildViews,
    noopPersist,
  );
  assert.equal(attempts, 2);
  assert.equal((first as unknown as { marker: string }).marker, "ok");
});
