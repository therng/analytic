import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

const viewports = [
  { name: "portrait", width: 430, height: 932 },
  { name: "landscape", width: 932, height: 430 },
] as const;

for (const viewport of viewports) {
  test(`dashboard secondary controls meet 44px touch targets in ${viewport.name}`, async () => {
    const css = await readFile(
      new URL("../../app/globals.css", import.meta.url),
      "utf8",
    );
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport });
      await page.setContent(`
        <style>${css}</style>
        <section class="dashboard-section">
          <article class="account-card">
            <div class="trade-distribution-panel">
              <div class="trade-distribution-panel__tabs">
                <button class="trade-distribution-panel__tab">MFE / P&amp;L</button>
              </div>
            </div>
            <div class="profit-heatmap-panel">
              <button class="heatmap-year-btn" aria-label="Previous year">‹</button>
            </div>
          </article>
        </section>
      `);

      for (const selector of [
        ".trade-distribution-panel__tab",
        ".heatmap-year-btn",
      ]) {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box, `${selector} must render`);
        assert.ok(box.width >= 44, `${selector} width was ${box.width}px`);
        assert.ok(box.height >= 44, `${selector} height was ${box.height}px`);
      }
    } finally {
      await browser.close();
    }
  });
}
