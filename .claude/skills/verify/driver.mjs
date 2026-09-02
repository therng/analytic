#!/usr/bin/env node
// Playwright driver for the analytic trading dashboard (forexvps host).
// Runs against the system browser (no `npx playwright install` needed on this host).
//
// Usage (node is often not on PATH in helper subshells — invoke it explicitly):
//   C:\nvm4w\nodejs\node.exe .claude/skills/verify/driver.mjs
//   C:\nvm4w\nodejs\node.exe .claude/skills/verify/driver.mjs --url http://localhost:3100 --viewport landscape --click-first --heatmap
//
// Exit codes: 0 = dashboard rendered (cards or clean empty state)
//             2 = app is up but accounts API failed ("Accounts unavailable" error state)
//             3 = app root never appeared (server down / crashed build)
//             1 = driver itself failed
// Prints one JSON summary line as the final stdout line.

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

// Default is the spare-port surface (:3100). Port 3000 is production
// (analytic-web NSSM) — pass --url http://localhost:3000 explicitly for
// post-deploy verification; the driver only ever reads.
const url = arg("url", process.env.ANALYTIC_URL || "http://localhost:3100");
const outDir = path.resolve(arg("out", path.join(scriptDir, "shots")));
const clickFirst = argv.includes("--click-first");
const heatmap = argv.includes("--heatmap");
const settleMs = Number(arg("settle-ms", "15000"));

const VIEWPORTS = {
  portrait: { width: 390, height: 844, isMobile: true, hasTouch: true },   // primary target surface (iOS Safari)
  landscape: { width: 844, height: 390, isMobile: true, hasTouch: true },  // two-zone layout, balance chart dominant
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false },
};
const viewportName = arg("viewport", "portrait");
const viewport = VIEWPORTS[viewportName] || VIEWPORTS.portrait;

// System browsers exist on this host; playwright bundled browsers were never downloaded.
// Order: stable Chrome → Edge → playwright's bundled chromium (if ever installed).
async function launchBrowser() {
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      // try next
    }
  }
  return chromium.launch({ headless: true });
}

const shots = [];
async function shot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
  return file;
}

function summary(obj) {
  console.log(JSON.stringify({ url, viewport: viewportName, ...obj }));
}

const CARD = "section.dashboard-section > .account-card";

const browser = await launchBrowser();
try {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

  // App root. If this never appears the server is up but serving junk (bad build / proxy error page).
  try {
    await page.waitForSelector("main.monitor-page", { timeout: 20000 });
  } catch {
    await shot(page, "no-root");
    summary({ state: "no-root", accounts: 0, shots, error: "main.monitor-page never appeared" });
    process.exitCode = 3;
    throw new Error("exit");
  }
  await shot(page, `01-root-${viewportName}`);

  // Dashboard settles into one of: cards rendered / error alert / candle animation (loading or empty).
  const deadline = Date.now() + settleMs;
  let state = "empty-or-loading";
  let accountCount = 0;
  while (Date.now() < deadline) {
    accountCount = await page.locator(CARD).count();
    if (accountCount > 0) {
      state = "accounts";
      break;
    }
    if (await page.locator('.candle-anim-container[role="alert"]').count() > 0) {
      state = "accounts-error";
      break;
    }
    await page.waitForTimeout(500);
  }

  await shot(page, `02-state-${state}-${viewportName}`);

  let heatmapCells = 0;

  // Drill: tap the first collapsed card (whole strip is the tap target; expansion
  // is one-way since 8.73) so the KPI surface opens — only when data exists.
  if (state === "accounts" && clickFirst) {
    const firstStrip = page.locator(`${CARD} .strip-tap`).first();
    await firstStrip.click();
    await page.waitForSelector(`${CARD}:has(.kgrid)`, { timeout: 15000 });
    await page.waitForTimeout(1200); // framer-motion expand transition
    await shot(page, `03-first-card-opened-${viewportName}`);
  }

  // Optional deep drill: tap the expanded card's PIPS chip → profit heatmap panel.
  // First server-side summary fetch can take seconds — poll for intensity cells
  // (up to 25s), don't fixed-wait.
  if (heatmap && state === "accounts" && clickFirst) {
    await page.locator(".kchip", { hasText: "PIPS" }).first().click();
    const hmDeadline = Date.now() + 25000;
    while (Date.now() < hmDeadline) {
      heatmapCells = await page.locator('[class*="heatmap-cell--"]').count();
      if (heatmapCells > 0) break;
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(800); // heatmap entrance transition
    await shot(page, `04-pips-heatmap-${viewportName}`);
  }

  summary({ state, accounts: accountCount, heatmapCells, shots });
  process.exitCode = state === "accounts-error" ? 2 : 0;
} catch (e) {
  if (e.message !== "exit") {
    summary({ state: "driver-failed", shots, error: String(e).slice(0, 300) });
    process.exitCode = process.exitCode || 1;
  }
} finally {
  await browser.close();
}
