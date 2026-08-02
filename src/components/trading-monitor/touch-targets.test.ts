import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

const viewports = [
  { name: "portrait", width: 430, height: 932 },
  { name: "landscape", width: 932, height: 430 },
] as const;
const minTouchTarget = 44;
const layoutTolerance = 0.01;

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
              <div role="tablist" aria-label="Trade distribution chart" class="trade-distribution-panel__tabs">
                <button class="trade-distribution-panel__tab" role="tab" aria-selected="true">MFE</button>
                <button class="trade-distribution-panel__tab" role="tab" aria-selected="false">MAE</button>
                <button class="trade-distribution-panel__tab" role="tab" aria-selected="false">TIME</button>
              </div>
            </div>
            <div class="profit-heatmap-panel">
              <div class="heatmap-header">
                <button class="heatmap-year-btn" aria-label="Previous year">‹</button>
                <span class="heatmap-year-label">2026</span>
                <button class="heatmap-year-btn" aria-label="Next year">›</button>
              </div>
            </div>
          </article>
        </section>
      `);

      const controls = [
        ...await page.locator(".trade-distribution-panel__tab").all(),
        ...await page.locator(".heatmap-year-btn").all(),
      ];
      assert.equal(controls.length, 5, "fixture must include all real controls");

      for (const control of controls) {
        const box = await control.boundingBox();
        const selector = await control.getAttribute("class");
        assert.ok(box, `${selector} must render`);
        assert.ok(
          box.width >= minTouchTarget - layoutTolerance,
          `${selector} width was ${box.width}px`,
        );
        assert.ok(
          box.height >= minTouchTarget - layoutTolerance,
          `${selector} height was ${box.height}px`,
        );
      }
    } finally {
      await browser.close();
    }
  });
}
