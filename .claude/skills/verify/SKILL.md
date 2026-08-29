# Verify: analytic dashboard on forexvps

How to build, launch, and drive the dashboard for runtime verification on the
forexvps Windows host (dev = prod single host).

## Build / launch

- Production web (`analytic-web` NSSM service) listens on **127.0.0.1:3000** — do not
  use that port. Worker health is on **:9200**. Pick a spare port (e.g. 3100).
- Fastest honest surface for an uncommitted change: `PORT=3100 npm run dev`
  (Next 16 Turbopack, ready in ~1.5s, loads `.env` → real Postgres/Redis data).
  Run it in the background; stop it after.
- `npm run start` (standalone) serves the *last build* — useless for verifying
  uncommitted changes.

## Drive (browser)

- Python Playwright is **not installed** on this host. Use the repo's Node
  Playwright (`node_modules/playwright`, no bundled browsers) with system Chrome:
  `chromium.launch({ channel: "chrome", headless: true })`.
- `node` is often not on PATH in helper subshells — invoke
  `C:\nvm4w\nodejs\node.exe` explicitly.
- Put the driver script inside `C:\analytic\` so ESM `import "playwright"`
  resolves; delete it afterwards.
- Viewport: 390x844, `isMobile`/`hasTouch` — the dashboard is mobile-first.

## Dashboard flows

- Cards render as compact strips; only the strip header shows when collapsed.
  Expand via `.strip-expand` (`aria-expanded`), then KPI chips are in `.kgrid`.
- Profit heatmap: click the **Pips** KPI chip → `.profit-heatmap-panel` appears
  with `.heatmap-cell--pos-N` / `--neg-N` intensity classes.
  The server-side summary can take seconds on first fetch — **poll** for
  intensity cells (up to ~25s), don't fixed-wait.
- Tooltips are tap-driven (`.sparkline-tooltip`), not hover.

## Gotchas

- The live-equity poll fires every 2s → `waitUntil: "networkidle"` never fires;
  use `domcontentloaded` + explicit selector waits.
- Computed-color assertions: `--card-positive` = `rgb(61, 214, 140)`,
  `--card-negative` = `rgb(240, 77, 77)`, `--gold-300` is (misleadingly) blue
  `#60a5fa` in this palette.
