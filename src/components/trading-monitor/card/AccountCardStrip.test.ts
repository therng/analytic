import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relative: string) {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("today rail lights per-segment and dims only when nothing is in the market", async () => {
  const source = await readSource("./AccountCardStrip.tsx");

  // Trades segment keyed on today_trade_count, open segment on openCount —
  // the rail never renders "0 trades" or "0 open" chips.
  assert.match(source, /const hasTradesToday = account\.today_trade_count > 0;/);
  assert.match(source, /const hasOpen = openCount > 0;/);
  assert.match(source, /const quiet = !hasTradesToday && !hasOpen;/);
  assert.match(source, /\{hasTradesToday \? \(/);
  assert.match(source, /\{hasOpen \? \(/);
  assert.match(source, /\{quiet \? \(/);
  assert.match(source, /today-rail__empty.*No trades today/s);
  assert.equal(source.includes("today_trade_count ?? 0"), false);
});

test("collapsed strip rides the accounts-list payload — today fields and open count", async () => {
  const [strip, lazy] = await Promise.all([
    readSource("./AccountCardStrip.tsx"),
    readSource("./LazyDashboardCard.tsx"),
  ]);

  // Strip is payload-driven (no fetch hooks); collapsed cards feed it
  // open_position_count + floating_pl straight from the list response.
  assert.equal(strip.includes("useApiResource"), false);
  assert.equal(strip.includes("useLiveData"), false);
  assert.match(lazy, /account-card--collapsed/);
  assert.match(lazy, /openCount=\{account\.open_position_count\}/);
  assert.match(lazy, /floatingPl=\{account\.floating_pl\}/);
  assert.match(lazy, /equity=\{account\.equity\}/);
});

test("collapsed cards mount no full card — the body only exists when expanded", async () => {
  const source = await readSource("./LazyDashboardCard.tsx");

  // The collapsed branch returns before any DashboardCard/deferred mount;
  // deferred loading is scoped to expanded-but-below-fold cards.
  const collapsedBranch = source.slice(
    source.indexOf("if (!expanded)"),
    source.indexOf("if (!shouldLoad)"),
  );
  assert.match(collapsedBranch, /<AccountCardStrip/);
  assert.equal(collapsedBranch.includes("<DashboardCard"), false);
  assert.equal(collapsedBranch.includes("<DeferredDashboardCard"), false);
});

test("expand control is a labeled 44px toggle with aria-expanded", async () => {
  const [component, css] = await Promise.all([
    readSource("./AccountCardStrip.tsx"),
    readSource("../../../app/globals.css"),
  ]);

  assert.match(component, /aria-expanded=\{expanded\}/);
  assert.match(
    component,
    /aria-label=\{`\$\{expanded \? "Collapse" : "Expand"\} \$\{accountDisplayName\} details`\}/,
  );
  assert.match(
    css,
    /\.dashboard-section > \.account-card \.strip-expand\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s,
  );
  assert.match(css, /\.strip-expand\.is-expanded svg\s*\{[^}]*rotate\(180deg\)/s);
  assert.match(css, /\.strip-expand:focus-visible\s*\{[^}]*outline:/s);
});

test("today rail stays legible: 12px mono minimum, pulse honors reduced motion", async () => {
  const css = await readSource("../../../app/globals.css");

  assert.match(
    css,
    /\.dashboard-section > \.account-card \.today-rail\s*\{[^}]*font-size:\s*12px;/s,
  );
  assert.match(css, /\.today-rail\s*\{[^}]*font-family:\s*var\(--font-mono\)/s);
  assert.match(css, /\.today-rail__live-dot\.is-live\s*\{[^}]*animation:/s);
  const reducedMotionBlocks = css.match(
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/g,
  );
  assert.ok(
    reducedMotionBlocks?.some((block) =>
      block.includes(".today-rail__live-dot.is-live"),
    ),
    "a reduced-motion block must disable the live-dot pulse",
  );
});

test("expanded-set persistence survives reloads via localStorage", async () => {
  const source = await readSource("../DashboardClient.tsx");

  assert.match(source, /analytic:expanded-cards/);
  assert.match(source, /readExpandedAccountIds\(\)/);
  assert.match(source, /writeExpandedAccountIds\(next\)/);
  // Applied post-mount (not in the initial state) so SSR HTML matches.
  assert.equal(source.includes("useState<Set<string>>(() => readExpanded"), false);
});

test("collapsed landscape cards stay compact chips, not full-height panels", async () => {
  const css = await readSource("../../../app/globals.css");
  const landscape = css.slice(css.indexOf("(orientation: landscape)"));

  assert.match(landscape, /\.account-card\.account-card--collapsed\s*\{/);
  assert.match(landscape, /align-self:\s*center;/);
  assert.match(landscape, /height:\s*auto;/);
});
