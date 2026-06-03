import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("home page does not block dashboard rendering with an artificial delay", async () => {
  const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("setTimeout"), false);
});
