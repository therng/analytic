import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("cached account routes only use the explicit timeframe query", async () => {
  const source = await readFile("src/app/api/accounts/[id]/route-helpers.ts", "utf8");

  assert.match(source, /parseRequestTimeframe\(searchParams\.get\("timeframe"\)\)/);
  assert.equal(source.includes("ignoreDashboardTimeframe"), false);
  assert.equal(source.includes('scope") === "allHistory"'), false);
});
