import { test } from "node:test";
import assert from "node:assert";
import {
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

test("set then get round-trips a JSON-safe view for the same version key", async () => {
  const store = new Map<string, string>();
  const client = fakeClient(store);
  const view = { overview: { kpis: { netProfit: 12.5 } } };

  await setCachedTimeframeView("acct-1", "1d", "v1", view, client);
  const hit = await getCachedTimeframeView("acct-1", "1d", "v1", client);

  assert.deepStrictEqual(hit, view);
});

test("a version-key change misses the cache (stale entries are naturally bypassed)", async () => {
  const store = new Map<string, string>();
  const client = fakeClient(store);
  const view = { overview: { kpis: { netProfit: 12.5 } } };

  await setCachedTimeframeView("acct-1", "1d", "v1", view, client);
  const miss = await getCachedTimeframeView("acct-1", "1d", "v2", client);

  assert.strictEqual(miss, null);
});

test("different timeframes for the same account/version do not collide", async () => {
  const store = new Map<string, string>();
  const client = fakeClient(store);

  await setCachedTimeframeView("acct-1", "1d", "v1", { day: true }, client);
  await setCachedTimeframeView("acct-1", "all", "v1", { day: false }, client);

  assert.deepStrictEqual(
    await getCachedTimeframeView("acct-1", "1d", "v1", client),
    { day: true },
  );
  assert.deepStrictEqual(
    await getCachedTimeframeView("acct-1", "all", "v1", client),
    { day: false },
  );
});

test("read failure falls back to null instead of throwing", async () => {
  const hit = await getCachedTimeframeView(
    "acct-1",
    "1d",
    "v1",
    throwingClient(),
  );
  assert.strictEqual(hit, null);
});

test("write failure resolves instead of throwing (cache is never a hard dependency)", async () => {
  await assert.doesNotReject(
    setCachedTimeframeView("acct-1", "1d", "v1", { a: 1 }, throwingClient()),
  );
});
