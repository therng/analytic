import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("BotPnLPanel trusts API-scoped history instead of applying client date filters", async () => {
  const source = await readFile(new URL("./BotPnLPanel.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("getSinceDate"), false);
  assert.match(source, /aggregate\(positions\)/);
});
