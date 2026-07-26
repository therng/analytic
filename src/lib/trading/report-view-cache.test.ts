import { test } from "node:test";
import assert from "node:assert";
import {
  createProcessLocalReportViewCache,
  getCachedTimeframeView,
  setCachedTimeframeView,
  type ReportViewCacheClient,
} from "./report-view-cache";

function fakeClient(store: Map<string, string>): ReportViewCacheClient {
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async setEx(key, _seconds, value) {
      store.set(key, value);
      return "OK";
    },
  };
}

function throwingClient(): ReportViewCacheClient {
  return {
    async get() {
      throw new Error("redis unavailable");
    },
    async setEx() {
      throw new Error("redis unavailable");
    },
  };
}

// Reachable but stalled — never resolves within the module's IO timeout.
function hangingClient(): ReportViewCacheClient {
  return {
    get: () => new Promise(() => {}),
    setEx: () => new Promise(() => {}),
  };
}

test("set then get round-trips a JSON-safe view for the same version keys", async () => {
  const store = new Map<string, string>();
  const client = fakeClient(store);
  const view = { overview: { kpis: { netProfit: 12.5 } } };

  await setCachedTimeframeView("acct-1", "1d", "v1", "e1", view, client);
  assert.deepStrictEqual([...store.keys()], [
    "report-view:v1:acct-1:1d:v1:e1",
  ]);
  const hit = await getCachedTimeframeView("acct-1", "1d", "v1", "e1", client);

  assert.deepStrictEqual(hit, view);
});

test("an aggregateVersionKey change misses the cache (stale entries are naturally bypassed)", async () => {
  const store = new Map<string, string>();
  const client = fakeClient(store);
  const view = { overview: { kpis: { netProfit: 12.5 } } };

  await setCachedTimeframeView("acct-1", "1d", "v1", "e1", view, client);
  const miss = await getCachedTimeframeView("acct-1", "1d", "v2", "e1", client);

  assert.strictEqual(miss, null);
});

test("an equityVersionKey change misses the cache even when aggregateVersionKey is unchanged", async () => {
  // Timeframe views embed equity-derived fields (floatingPL, openPositions,
  // the 1D balance curve) — the view itself is equity-sensitive, not just
  // the deal/position aggregate. An equity-only update (e.g. an equity
  // sampler tick or patchEquitySnapshots) must bust the L2 entry even
  // though aggregateVersionKey stays flat, or a stale equity snapshot would
  // be served for up to the cache TTL.
  const store = new Map<string, string>();
  const client = fakeClient(store);
  const staleView = { overview: { kpis: { floatingPL: 100 } } };

  await setCachedTimeframeView("acct-1", "1d", "v1", "e1", staleView, client);
  const miss = await getCachedTimeframeView("acct-1", "1d", "v1", "e2", client);

  assert.strictEqual(miss, null);

  const freshView = { overview: { kpis: { floatingPL: 250 } } };
  await setCachedTimeframeView("acct-1", "1d", "v1", "e2", freshView, client);

  assert.deepStrictEqual(
    await getCachedTimeframeView("acct-1", "1d", "v1", "e2", client),
    freshView,
  );
  // The stale entry under the old equity key is untouched but no longer
  // reachable through the current (v1, e2) lookup path.
  assert.deepStrictEqual(
    await getCachedTimeframeView("acct-1", "1d", "v1", "e1", client),
    staleView,
  );
});

test("different timeframes for the same account/version do not collide", async () => {
  const store = new Map<string, string>();
  const client = fakeClient(store);

  await setCachedTimeframeView("acct-1", "1d", "v1", "e1", { day: true }, client);
  await setCachedTimeframeView("acct-1", "all", "v1", "e1", { day: false }, client);

  assert.deepStrictEqual(
    await getCachedTimeframeView("acct-1", "1d", "v1", "e1", client),
    { day: true },
  );
  assert.deepStrictEqual(
    await getCachedTimeframeView("acct-1", "all", "v1", "e1", client),
    { day: false },
  );
});

test("process-local Redis hits retain version metadata and views for the revalidation window", () => {
  let now = 1_000;
  const cache = createProcessLocalReportViewCache<{ overview: string }>({
    ttlMs: 5_000,
    maxEntries: 2,
    now: () => now,
  });

  cache.set("acct-1", "1d", "aggregate-1", "equity-1", {
    overview: "cached",
  });

  assert.deepStrictEqual(cache.get("acct-1", "1d"), {
    aggregateVersionKey: "aggregate-1",
    equityVersionKey: "equity-1",
    view: { overview: "cached" },
  });
  assert.deepStrictEqual(cache.get("acct-1", "all"), {
    aggregateVersionKey: "aggregate-1",
    equityVersionKey: "equity-1",
    view: null,
  });

  now = 4_000;
  cache.set("acct-1", "all", "aggregate-1", "equity-1", {
    overview: "cached-all",
  });

  now = 6_001;
  assert.strictEqual(cache.get("acct-1", "1d"), null);
});

test("process-local Redis hits are isolated from caller mutations", () => {
  const cache = createProcessLocalReportViewCache<{
    balanceDetail: { equityCurve: number[] };
  }>({
    ttlMs: 5_000,
    maxEntries: 2,
  });
  const view = { balanceDetail: { equityCurve: [1, 2] } };

  cache.set("acct-1", "1d", "aggregate-1", "equity-1", view);
  view.balanceDetail.equityCurve.push(3);
  const firstHit = cache.get("acct-1", "1d");
  firstHit?.view?.balanceDetail.equityCurve.push(4);

  assert.deepStrictEqual(
    cache.get("acct-1", "1d")?.view?.balanceDetail.equityCurve,
    [1, 2],
  );
});

test("process-local Redis hits evict oldest accounts to stay within the byte budget", () => {
  const cache = createProcessLocalReportViewCache<{ payload: string }>({
    ttlMs: 5_000,
    maxEntries: 10,
    maxBytes: 90,
  });

  cache.set("acct-1", "1d", "aggregate-1", "equity-1", {
    payload: "a".repeat(40),
  });
  cache.set("acct-2", "1d", "aggregate-2", "equity-2", {
    payload: "b".repeat(40),
  });

  assert.strictEqual(cache.get("acct-1", "1d"), null);
  assert.deepStrictEqual(cache.get("acct-2", "1d")?.view, {
    payload: "b".repeat(40),
  });
});

test("read failure falls back to null instead of throwing", async () => {
  const hit = await getCachedTimeframeView(
    "acct-1",
    "1d",
    "v1",
    "e1",
    throwingClient(),
  );
  assert.strictEqual(hit, null);
});

test("write failure resolves instead of throwing (cache is never a hard dependency)", async () => {
  await assert.doesNotReject(
    setCachedTimeframeView(
      "acct-1",
      "1d",
      "v1",
      "e1",
      { a: 1 },
      throwingClient(),
    ),
  );
});

test("a stalled (reachable but non-responsive) read degrades to a miss rather than hanging the caller", async () => {
  const start = Date.now();
  const hit = await getCachedTimeframeView(
    "acct-1",
    "1d",
    "v1",
    "e1",
    hangingClient(),
  );
  assert.strictEqual(hit, null);
  // Must resolve well under Node's default test timeout — proves the read
  // was bounded, not silently hanging until something else killed it.
  assert.ok(Date.now() - start < 5000);
});

test("a stalled write resolves instead of hanging the caller", async () => {
  const start = Date.now();
  await setCachedTimeframeView(
    "acct-1",
    "1d",
    "v1",
    "e1",
    { a: 1 },
    hangingClient(),
  );
  assert.ok(Date.now() - start < 5000);
});

test("an oversized view is not written to the cache (guards against unbounded Redis payload growth)", async () => {
  const store = new Map<string, string>();
  const client = fakeClient(store);
  // historyPositions on a heavy account can be arbitrarily large; simulate
  // that here rather than actually building a huge fixture.
  const oversizedView = { historyPositions: "x".repeat(600 * 1024) };

  await setCachedTimeframeView("acct-1", "1d", "v1", "e1", oversizedView, client);

  assert.strictEqual(store.size, 0);
  assert.strictEqual(
    await getCachedTimeframeView("acct-1", "1d", "v1", "e1", client),
    null,
  );
});
