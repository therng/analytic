import { expect, test, type Page } from "playwright/test";

async function renderPipsPanel(page: Page) {
  await page.setContent(`
    <main class="dashboard-section">
      <article class="account-card">
        <div class="sp-canvas">
          <div class="sp-overlay-panel sp-overlay-panel--pips">
            <section class="pips-performance">
              <div class="pips-performance__table-shell">
                <table class="pips-performance__table">
                  <thead><tr><th></th><th>Return</th><th>Profit</th><th>Pips</th><th>Lot</th></tr></thead>
                  <tbody>
                    <tr><th>Yesterday</th><td>1.0%</td><td>100.00</td><td>10.0</td><td>1.0</td></tr>
                    <tr><th>Today</th><td>1.0%</td><td>100.00</td><td>10.0</td><td>1.0</td></tr>
                    <tr><th>This week</th><td>1.0%</td><td>100.00</td><td>10.0</td><td>1.0</td></tr>
                    <tr><th>This month</th><td>1.0%</td><td>100.00</td><td>10.0</td><td>1.0</td></tr>
                    <tr><th>This year</th><td>1.0%</td><td>100.00</td><td>10.0</td><td>1.0</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
            <div class="profit-heatmap-panel">
              <div class="heatmap-header"><span class="heatmap-year-label">2026</span></div>
              <div class="heatmap-body">
                <div class="heatmap-day-labels">
                  <span class="heatmap-day-label"></span><span class="heatmap-day-label">M</span>
                  <span class="heatmap-day-label"></span><span class="heatmap-day-label">W</span>
                  <span class="heatmap-day-label"></span><span class="heatmap-day-label">F</span>
                  <span class="heatmap-day-label"></span>
                </div>
                <div class="heatmap-scroll">
                  <div class="heatmap-months">${"<span class=\"heatmap-month-cell\">Jan</span>".repeat(53)}</div>
                  <div class="heatmap-grid">${"<span class=\"heatmap-cell\"></span>".repeat(371)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </article>
    </main>
  `);
  await page.addStyleTag({ path: "src/app/globals.css" });
}

async function readPipsPanelLayout(page: Page) {
  return page.locator(".sp-overlay-panel--pips").evaluate((panel) => {
    const heatmap = panel.querySelector<HTMLElement>(".heatmap-scroll");
    if (!heatmap) throw new Error("heatmap scroll container is missing");
    return {
      panelClientHeight: panel.clientHeight,
      panelScrollHeight: panel.scrollHeight,
      panelOverflowY: getComputedStyle(panel).overflowY,
      heatmapClientWidth: heatmap.clientWidth,
      heatmapScrollWidth: heatmap.scrollWidth,
      heatmapOverflowX: getComputedStyle(heatmap).overflowX,
    };
  });
}

for (const viewport of [
  { name: "portrait", width: 390, height: 844 },
  { name: "landscape", width: 844, height: 390 },
]) {
  test(`pips panel fits vertically in mobile ${viewport.name} while the heatmap remains horizontally scrollable`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await renderPipsPanel(page);
    const layout = await readPipsPanelLayout(page);

    expect(layout.panelScrollHeight).toBeLessThanOrEqual(layout.panelClientHeight);
    expect(layout.panelOverflowY).toBe("hidden");
    expect(layout.heatmapScrollWidth).toBeGreaterThan(layout.heatmapClientWidth);
    expect(layout.heatmapOverflowX).toBe("auto");
  });
}
