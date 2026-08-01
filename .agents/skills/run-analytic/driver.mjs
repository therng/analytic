#!/usr/bin/env node
// Minimal chromium-cli-style REPL for the analytic dashboard.
// Reads newline-delimited commands from stdin (or a script file arg):
//   nav <url>
//   wait <ms>
//   wait-for-text <text>            (polls up to 15s)
//   click-text <text>               (clicks first element containing text)
//   screenshot <path>
//   console-errors
//   viewport <width> <height>       (default 430x932, mobile portrait)
//
// Usage:
//   node .claude/skills/run-analytic/driver.mjs script.txt
//   node .claude/skills/run-analytic/driver.mjs <<'EOF' ... EOF
//
// Must run from the repo root so the `playwright` package resolves.

import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const scriptPath = process.argv[2];
const lines = scriptPath
  ? readFileSync(scriptPath, "utf8").split("\n")
  : readFileSync(0, "utf8").split("\n");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(String(e)));

for (const raw of lines) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const [cmd, ...rest] = line.split(" ");
  const arg = rest.join(" ");
  try {
    switch (cmd) {
      case "nav":
        await page.goto(arg, { waitUntil: "networkidle", timeout: 30000 });
        console.log(`nav ${arg} -> ok`);
        break;
      case "wait":
        await page.waitForTimeout(Number(arg));
        break;
      case "wait-for-text":
        await page.locator(`text=${arg}`).first().waitFor({ timeout: 15000 });
        console.log(`wait-for-text "${arg}" -> found`);
        break;
      case "click-text":
        await page.locator(`text=${arg}`).first().click();
        console.log(`click-text "${arg}" -> clicked`);
        break;
      case "screenshot":
        await page.screenshot({ path: arg });
        console.log(`screenshot -> ${arg}`);
        break;
      case "viewport": {
        const [w, h] = rest.map(Number);
        await page.setViewportSize({ width: w, height: h });
        console.log(`viewport -> ${w}x${h}`);
        break;
      }
      case "console-errors":
        console.log("console-errors:", consoleErrors.length ? consoleErrors : "none");
        break;
      default:
        console.log(`unknown command: ${cmd}`);
    }
  } catch (err) {
    console.log(`${cmd} ${arg} -> ERROR: ${err.message}`);
  }
}

await browser.close();
