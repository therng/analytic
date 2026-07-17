import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("MaeMfePanel renders a finite win/loss MAE MFE scatter with complete states", async () => {
  const source = await readFile(
    new URL("./MaeMfePanel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /dynamic\(\(\) => import\("react-apexcharts"\), \{ ssr: false \}\)/,
  );
  assert.match(source, /type: "scatter"/);
  assert.match(
    source,
    /title: \{\s*text: "MAE",\s*style: \{\s*color: "rgba\(240,242,245,0\.65\)",\s*fontSize: "9px",\s*fontFamily: "var\(--font-mono\)",\s*\},\s*\}/,
  );
  assert.match(
    source,
    /title: \{\s*text: "MFE",\s*style: \{\s*color: "rgba\(240,242,245,0\.65\)",\s*fontSize: "9px",\s*fontFamily: "var\(--font-mono\)",\s*\},\s*\}/,
  );
  assert.match(source, /name: "Win"/);
  assert.match(source, /name: "Loss"/);
  assert.match(source, /point\.netPnl > 0/);
  assert.match(source, /point\.mae != null/);
  assert.match(source, /point\.mfe != null/);
  assert.match(source, /Number\.isFinite\(point\.mae\)/);
  assert.match(source, /Number\.isFinite\(point\.mfe\)/);
  assert.match(source, /#3dd68c/);
  assert.match(source, /#f04d4d/);
  assert.match(source, /formatSignedCurrency\(datum\.x, 2\)/);
  assert.match(source, /formatSignedCurrency\(datum\.y, 2\)/);
  assert.match(source, /formatSignedCurrency\(datum\.netPnl, 2\)/);
  assert.match(source, /legend: \{[\s\S]*show: true[\s\S]*position: "bottom"/);
  assert.match(source, /skeleton-chart account-card__chart-skeleton/);
  assert.match(source, /tone="error"/);
  assert.match(source, /mfeMae\.available/);
  assert.match(source, /mfeMae\.reason/);
  assert.match(source, /No excursion samples yet/);
  assert.match(source, /Showing latest 500 trades/);
  assert.equal(/annotations|trendline/i.test(source), false);
});
