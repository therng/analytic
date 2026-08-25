import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Source-contract tests (repo harness has no React renderer): pin the
// stale-while-switch behavior that keeps timeframe switches flash-free.

test("timeframe switch keeps the previous resource's data visible while fetching", async () => {
  const source = await readFile(new URL("./useApiResource.ts", import.meta.url), "utf8");

  // The switch transition must NOT null out data — chips would flash "-"
  // and the chart would flip to a skeleton for the whole round trip.
  // Stale data is kept and swapped when the new payload lands.
  assert.equal(
    source.includes("data: isSameResource ? current.data : null"),
    false,
    "useApiResource must keep stale data across resource switches (stale-while-switch)",
  );
  assert.match(
    source,
    /data: current\.data,/,
    "the URL-change transition should carry current.data forward",
  );
});

test("cache-hit early return still serves settled LRU entries without network", async () => {
  const source = await readFile(new URL("./useApiResource.ts", import.meta.url), "utf8");
  assert.match(source, /resourceCache\.get\(url\)/);
  assert.match(source, /refreshKey === 0/);
});
