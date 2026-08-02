import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("TradeHistoryPanel does not render MAE/MFE detail rows", async () => {
  const source = await readFile(
    new URL("./TradeHistoryPanel.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /MAE P\/L/);
  assert.doesNotMatch(source, /MFE P\/L/);
  assert.doesNotMatch(source, /position\.mae/);
  assert.doesNotMatch(source, /position\.mfe/);
});

test("expanded trade comments wrap instead of clipping", async () => {
  const css = await readFile(
    new URL("../../app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(
    css,
    /\.trade-history-row__detail--comment\s*\{[\s\S]*?grid-column:\s*1 \/ -1;[\s\S]*?\}/,
  );
  assert.match(
    css,
    /\.trade-history-row__val--comment\s*\{[\s\S]*?white-space:\s*normal;[\s\S]*?text-overflow:\s*clip;[\s\S]*?\}/,
  );
  assert.doesNotMatch(
    css.match(/\.trade-history-row__val--comment\s*\{[\s\S]*?\}/)?.[0] ?? "",
    /white-space:\s*nowrap|overflow:\s*hidden|text-overflow:\s*ellipsis/,
  );
});
