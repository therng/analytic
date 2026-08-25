import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relative: string) {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("expand chevron trails the account name inside the name row", async () => {
  const source = await readSource("./AccountCardStrip.tsx");

  const nameRow = source.slice(
    source.indexOf('<div className="sp-name-row">'),
    source.indexOf('<div className="sp-account">'),
  );
  assert.match(nameRow, /className="sp-name"/);
  assert.match(nameRow, /className=\{`strip-expand\$\{expanded \? " is-expanded" : ""\}`\}/);
  // The chevron comes after the name, before any other element in the row.
  assert.ok(
    nameRow.indexOf("sp-name") < nameRow.indexOf("strip-expand"),
    "chevron must follow the name",
  );
  // And it is the only render site — sp-side stays numbers only.
  assert.equal((source.match(/strip-expand\$\{/g) ?? []).length, 1);
});

test("TODAY rail is gone — the strip carries identity, growth, equity only", async () => {
  const [component, css] = await Promise.all([
    readSource("./AccountCardStrip.tsx"),
    readSource("../../../app/globals.css"),
  ]);

  for (const source of [component, css]) {
    assert.equal(source.includes("today-rail"), false);
    assert.equal(source.includes("No trades today"), false);
  }
  // Rail-only props went with it (the balance flash's `is-current-live`
  // class legitimately remains — assert the prop signatures, not substrings).
  assert.equal(component.includes("openCount"), false);
  assert.equal(component.includes("floatingPl"), false);
  assert.equal(component.includes("live:"), false);
  assert.equal(component.includes("live={"), false);
});

test("collapsed strip rides the accounts-list payload — no per-card requests", async () => {
  const [strip, lazy] = await Promise.all([
    readSource("./AccountCardStrip.tsx"),
    readSource("./LazyDashboardCard.tsx"),
  ]);

  assert.equal(strip.includes("useApiResource"), false);
  assert.equal(strip.includes("useLiveData"), false);
  assert.match(lazy, /account-card--collapsed/);
  assert.match(lazy, /equity=\{account\.equity\}/);
});

test("expansion is activity-driven: traded today or holding positions stays full", async () => {
  const source = await readSource("./LazyDashboardCard.tsx");

  assert.match(
    source,
    /const isTradingToday =\s*account\.today_trade_count > 0 \|\| account\.open_position_count > 0;/,
  );
  assert.match(source, /const expanded = expansionOverride \?\? isTradingToday;/);
});

test("collapsed cards mount no full card — the body only exists when expanded", async () => {
  const source = await readSource("./LazyDashboardCard.tsx");

  const collapsedBranch = source.slice(
    source.indexOf("if (!expanded)"),
    source.indexOf("if (!shouldLoad)"),
  );
  assert.match(collapsedBranch, /<AccountCardStrip/);
  assert.equal(collapsedBranch.includes("<DashboardCard"), false);
  assert.equal(collapsedBranch.includes("<DeferredDashboardCard"), false);
});

test("manual expansion is a session-only pin — no persistence", async () => {
  const source = await readSource("../DashboardClient.tsx");

  assert.equal(source.includes("localStorage"), false);
  assert.equal(source.includes("analytic:expanded-cards"), false);
  assert.match(source, /cardExpansionOverrides/);
  assert.match(source, /expansionOverride=\{cardExpansionOverrides\[account\.id\]\}/);
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

test("deferred placeholder renders the same strip header — no balance/growth regression", async () => {
  const source = await readSource("./DeferredDashboardCard.tsx");

  assert.match(source, /<AccountCardStrip/);
  assert.match(source, /equity=\{account\.equity\}/);
  assert.match(source, /onToggleExpanded=\{onToggleExpanded\}/);
  // The old placeholder header showed balance + null growth — both gone.
  assert.equal(source.includes("formatCurrency"), false);
  assert.equal(source.includes("formatPercent"), false);
});

test("collapsed names truncate to one line and the intrinsic estimate matches", async () => {
  const css = await readSource("../../../app/globals.css");
  const collapsedBlock = css.match(
    /\.dashboard-section > \.account-card\.account-card--collapsed \.sp-name\s*\{[^}]*\}/,
  );

  assert.ok(collapsedBlock, "collapsed name rule must exist");
  assert.match(collapsedBlock[0], /white-space:\s*nowrap;/);
  assert.match(collapsedBlock[0], /text-overflow:\s*ellipsis;/);
  assert.match(
    css,
    /\.account-card\.account-card--collapsed\s*\{[^}]*contain-intrinsic-size:\s*auto 52px;/s,
  );
});

test("collapsed landscape cards stay compact chips, not full-height panels", async () => {
  const css = await readSource("../../../app/globals.css");
  const landscape = css.slice(css.indexOf("(orientation: landscape)"));

  assert.match(landscape, /\.account-card\.account-card--collapsed\s*\{/);
  assert.match(landscape, /align-self:\s*center;/);
  assert.match(landscape, /height:\s*auto;/);
  assert.match(landscape, /contain-intrinsic-size:\s*auto 61px;/);
});
