import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("safe-area insets are enabled only for standalone PWA mode", async () => {
  const source = await readFile(new URL("./globals.css", import.meta.url), "utf8");
  const appScroll = source.match(/\.app-scroll\s*\{([\s\S]*?)\n\}/)?.[1];

  assert.ok(appScroll, "expected .app-scroll CSS block");
  assert.match(source, /--safe-top:\s*0px;/);
  assert.match(source, /--safe-bottom:\s*0px;/);
  assert.match(source, /--safe-left:\s*0px;/);
  assert.match(source, /--safe-right:\s*0px;/);
  assert.match(
    source,
    /@media\s*\(display-mode:\s*standalone\)\s*\{[\s\S]*?:root\s*\{[\s\S]*?--safe-top:\s*env\(safe-area-inset-top,\s*0px\)[\s\S]*?--safe-right:\s*env\(safe-area-inset-right,\s*0px\)[\s\S]*?--safe-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)[\s\S]*?--safe-left:\s*env\(safe-area-inset-left,\s*0px\)/,
  );
  assert.match(appScroll, /padding-top:\s*calc\(12px \+ var\(--safe-top\)\)/);
  assert.doesNotMatch(appScroll, /env\(safe-area-inset-/);
  assert.match(source, /padding-right:\s*calc\(8px \+ var\(--safe-right\)\)/);
  assert.match(source, /padding-left:\s*calc\(8px \+ var\(--safe-left\)\)/);
  assert.match(source, /100vw - 16px - var\(--safe-left\) - var\(--safe-right\)/);
});

test("portrait browser mode uses document scrolling so Safari chrome can collapse", async () => {
  const [css, dashboard] = await Promise.all([
    readFile(new URL("./globals.css", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../components/trading-monitor/DashboardClient.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(
    css,
    /@media\s*\(orientation:\s*portrait\)\s*and\s*\(display-mode:\s*browser\)[\s\S]*?\.monitor-page\s*\{[\s\S]*?height:\s*auto;[\s\S]*?overflow:\s*visible;[\s\S]*?\.app-scroll\s*\{[\s\S]*?height:\s*auto;[\s\S]*?overflow-y:\s*visible;/,
  );
  assert.match(
    dashboard,
    /scrollNode\s*&&\s*scrollNode\.scrollHeight\s*>\s*scrollNode\.clientHeight/,
  );
});
