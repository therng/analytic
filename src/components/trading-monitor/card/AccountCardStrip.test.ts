import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readSource(relative: string) {
  return readFile(new URL(relative, import.meta.url), "utf8");
}

test("the strip carries no expand control — the name row holds the name only", async () => {
  const source = await readSource("./AccountCardStrip.tsx");

  const nameRow = source.slice(
    source.indexOf('<div className="sp-name-row">'),
    source.indexOf('<div className="sp-account">'),
  );
  assert.match(nameRow, /className="sp-name"/);
  // The expand tap target lives one level up (LazyDashboardCard's .strip-tap),
  // so the strip itself must stay free of any button/interactive markup.
  assert.equal(source.includes("strip-expand"), false);
  assert.equal(source.includes("<button"), false);
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

test("expansion is autonomous: a position opened within 24h keeps the full card", async () => {
  const source = await readSource("./LazyDashboardCard.tsx");

  // The 24h window is evaluated server-side at serialization — the client
  // renders the stable per-payload boolean and never consults the wall
  // clock during render.
  assert.match(
    source,
    /const expanded = expansionOverride \?\? account\.position_opened_recently;/,
  );
  assert.equal(source.includes("Date.now()"), false);
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

test("manual expansion is a one-way session-only pin — no persistence, no manual collapse", async () => {
  const source = await readSource("../DashboardClient.tsx");

  assert.equal(source.includes("localStorage"), false);
  assert.equal(source.includes("analytic:expanded-cards"), false);
  assert.match(source, /cardExpansionOverrides/);
  assert.match(source, /expansionOverride=\{cardExpansionOverrides\[account\.id\]\}/);
  // The pin only ever sets true — collapsing is the autonomous rule's job.
  assert.match(source, /\[accountId\]: true,/);
});

test("the collapsed card is a labeled full-strip tap target with focus visibility", async () => {
  const [lazy, css] = await Promise.all([
    readSource("./LazyDashboardCard.tsx"),
    readSource("../../../app/globals.css"),
  ]);

  // The whole strip is the button — the 44×44 minimum is met by the full
  // card-width strip itself, so the CSS contract is full-bleed + press
  // feedback + focus ring instead of a sized hit box.
  assert.match(lazy, /className="strip-tap"/);
  assert.match(
    lazy,
    /aria-label=\{`Expand \$\{displayName\(account\)\} details`\}/,
  );
  assert.match(
    css,
    /\.dashboard-section > \.account-card \.strip-tap\s*\{[^}]*width:\s*100%;[^}]*touch-action:\s*manipulation;/s,
  );
  assert.match(css, /\.strip-tap:active\s*\{[^}]*transform:/s);
  assert.match(css, /\.strip-tap:focus-visible\s*\{[^}]*outline:/s);
});

test("deferred placeholder renders the same strip header — no balance/growth regression", async () => {
  const source = await readSource("./DeferredDashboardCard.tsx");

  assert.match(source, /<AccountCardStrip/);
  assert.match(source, /equity=\{account\.equity\}/);
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
