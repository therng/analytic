#!/usr/bin/env node
// Playwright driver for the analytic trading dashboard.
// Runs against the system browser (no `npx playwright install` needed on this host).
//
// Usage:
//   node .claude/skills/run-analytic/driver.mjs
//   node .claude/skills/run-analytic/driver.mjs --url http://127.0.0.1:3000 --out shots --viewport portrait
//
// Exit codes: 0 = dashboard rendered (cards or clean empty state)
//             2 = app is up but accounts API failed ("Accounts unavailable" error state)
//             3 = app root never appeared (server down / crashed build)
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

const url = arg("url", process.env.ANALYTIC_URL || "http://127.0.0.1:3000");
const outDir = path.resolve(arg("out", path.join(scriptDir, "shots")));
const clickFirst = argv.includes("--click-first");
const settleMs = Number(arg("settle-ms", "15000"));

const VIEWPORTS = {
  portrait: { width: 390, height: 844 },   // mobile portrait (primary target surface)
  landscape: { width: 844, height: 390 },  // mobile landscape two-zone layout
  desktop: { width: 1440, height: 900 },
};
const viewportName = arg("viewport", "portrait");
const viewport = VIEWPORTS[viewportName] || VIEWPORTS.portrait;

// System browsers exist on this host; playwright bundled browsers were never downloaded.
// Order: stable Chrome → Edge → playwright's bundled chromium (if ever installed).
async function launchBrowser() {
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (e) {
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
    accountCount = await page.locator("section.dashboard-section > *").count();
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

  // Drill: tap the first account card so the detail/KPI surface opens (only when data exists).
  if (clickFirst && state === "accounts") {
    const firstCard = page.locator("section.dashboard-section > *").first();
    await firstCard.click();
    await page.waitForTimeout(1200); // framer-motion expand transition
    await shot(page, `03-first-card-opened-${viewportName}`);
  }

  summary({
    state,
    accounts: accountCount,
    shots,
  });
  process.exitCode = state === "accounts-error" ? 2 : 0;
} catch (e) {
  if (e.message !== "exit") {
    summary({ state: "driver-failed", shots, error: String(e).slice(0, 300) });
    process.exitCode = process.exitCode || 1;
  }
} finally {
  await browser.close();
}
