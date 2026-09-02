---
name: verify
description: "Run, launch, build, screenshot, and verify the analytic trading dashboard on the forexvps Windows host. Use when asked to run or start the app, check or open the dashboard, take a screenshot, smoke-test the web tier, or verify a change/deploy at runtime. Covers the committed Playwright driver + smoke script, spare-port launches, production post-deploy verification, and dashboard polling gotchas."
---

# Verify: analytic dashboard on forexvps

How to build, launch, and drive the dashboard for runtime verification on the
forexvps Windows host (dev = prod single host). The agent path is one command —
`smoke.sh` starts the app on a spare port if none is running, probes the APIs,
screenshots the dashboard with the Playwright driver (`driver.mjs`, system
Chrome), and stops only a server it started itself. All paths below are
relative to the repo root (`C:\analytic`). Every command here was executed on
this host; harness re-verified 2026-09-02 against build 8.74.

## Prerequisites (already satisfied on this host)

- Node 24 via nvm4w — `node` is often NOT on PATH in helper subshells; invoke
  `C:\nvm4w\nodejs\node.exe` explicitly (or `export PATH="/c/nvm4w/nodejs:$PATH"`).
- `node_modules/` installed; Prisma client generated (`npx prisma generate`).
- System Chrome (or Edge) at the default Program Files path — the driver
  launches `channel: "chrome"`. Playwright ships as a repo dependency; bundled
  browsers were never downloaded here and are not needed.
- A `.env` at repo root and in `.next/standalone/` (DATABASE_URL, REDIS_URL, TZ) —
  the standalone server loads it from its cwd, so a manual spare-port launch
  needs no secret handling.

## Run (agent path)

```bash
bash .claude/skills/verify/smoke.sh                       # render check + screenshots
bash .claude/skills/verify/smoke.sh --click-first --heatmap   # full drill: expand card → PIPS heatmap
ANALYTIC_URL=http://localhost:3000 bash .claude/skills/verify/smoke.sh   # post-deploy verify of production
```

- Default URL `http://localhost:3100` (spare port). If nothing listens there the
  script starts `.next/standalone/server.js` on 3100 (falls back to `next dev`
  when no build exists), waits for `/api/health`, probes `/api/accounts`,
  runs the driver, then stops the server it started (port-resolved PID —
  a bash `&` wrapper does not kill node children on Windows).
- Driver prints one JSON summary line: `state` (`accounts` / `accounts-error` /
  `empty-or-loading` / `no-root`), `accounts`, `heatmapCells`, `shots[]`.
  Exit codes: 0 rendered, 2 accounts-error, 3 no-root, 4 refused to touch
  production.
- Screenshots land in `.claude/skills/verify/shots/` (gitignored). **Look at
  them** — a 200 status with a blank page is not a pass.
- `--viewport portrait|landscape|desktop` (portrait 390x844 isMobile+hasTouch
  is the primary target surface).

**Production guard:** the script never starts or kills anything on port 3000
(`analytic-web` NSSM owns it). `ANALYTIC_URL=http://localhost:3000` runs
probe + screenshot only — the documented post-deploy check. Health endpoints
that matter: `:9200/health` (worker, component-aware — `/api/health` proves
liveness only), `:3000/api/accounts` (judge by status code).

## Build

```bash
npm ci && npx prisma generate && npm run build && npm run build:worker-v2
```

`npm run build` chains the view-worker build + `next build` +
`scripts/sync-standalone.mjs` (copies `.next/static`, `public/`,
`dist/view-build-worker.js` into `.next/standalone`).

**Stop `analytic-web` + `caddy` before building** — the running server holds
`.next/standalone` and the build dies with `EBUSY: resource busy or locked,
rmdir ...standalone`. Stop `analytic-worker` too: `npx prisma generate` can hit
`EPERM` on the Prisma engine DLL the worker has loaded. Bring services back
worker → web → caddy, verifying each (`nssm status` → port probe). Service
control is nssm-only — see the vps-ops skill.

## Direct invocation

Drive a single flow without the smoke wrapper (server already up on 3100):

```bash
C:/nvm4w/nodejs/node.exe .claude/skills/verify/driver.mjs --url http://localhost:3100 --click-first
```

The driver is also the reference for ad-hoc Playwright scripts: put them inside
`C:\analytic\` so ESM `import "playwright"` resolves, use
`chromium.launch({ channel: "chrome", headless: true })`, and delete the script
afterwards if it was one-off.

## Run (human path)

`npm run dev` (Turbopack, ~1.5s ready, real Postgres/Redis via `.env`) or
`npm run start` (serves the **last build** — useless for verifying uncommitted
changes). Both bind the terminal; Ctrl-C to stop. `npm run start` on this host
conflicts with production's port unless `PORT` is overridden.

## Dashboard flows (verified selectors)

- Cards render as compact strips (`section.dashboard-section > .account-card`);
  only the strip header shows when collapsed. Expand by tapping the collapsed
  card itself (`.strip-tap` button wrapping the strip — one-way expand since
  8.73; cards with open positions in the last 24h auto-expand). KPI chips live
  in `.kgrid`; chip labels come from `src/lib/trading/metric-registry.ts`
  (`GAIN, DD, MAX, PIPS, TRADES, OPENS, ...`).
- Profit heatmap: tap the **PIPS** chip (`.kchip` containing "PIPS") →
  `.profit-heatmap-panel` appears with `heatmap-cell--pos-N` / `--neg-N`
  intensity classes. First server-side summary fetch can take seconds — **poll**
  for cells (up to ~25s), don't fixed-wait.
- App root selector `main.monitor-page`; the accounts-error state is
  `.candle-anim-container[role="alert"]` (the loading candle animation uses the
  same class WITHOUT `role="alert"`).
- Tooltips are tap-driven (`.sparkline-tooltip`), not hover.

## Gotchas

- The live-equity poll fires every 2s → `waitUntil: "networkidle"` never fires;
  use `domcontentloaded` + explicit selector waits.
- Target the server via `localhost`, never `127.0.0.1` — Next 16 blocks
  cross-origin dev resources for mismatched dev origins and the client
  silently never fires its data fetches (page mounts, zero API requests).
- Computed-color assertions: `--card-positive` = `rgb(61, 214, 140)`,
  `--card-negative` = `rgb(240, 77, 77)`, `--gold-300` is (misleadingly) blue
  `#60a5fa` in this palette.
- Killing a server you started from a script: resolve the PID from the port
  (`netstat -ano | grep :3100 | grep LISTENING`) and `taskkill //F //PID <pid>`
  — killing the bash background job wrapper leaves node alive → EADDRINUSE
  next launch.
- `npx playwright install` is neither needed nor present — always system
  Chrome/Edge channels.

## Troubleshooting

- `EBUSY ... rmdir 'C:\analytic\.next\standalone'` during build → a server is
  still running: `nssm stop analytic-web` (and caddy), kill orphans via the
  netstat+taskkill pair above, rebuild.
- `EPERM` on a Prisma engine DLL during `prisma generate`/`npm ci` →
  `nssm stop analytic-worker` first, retry.
- Exit 3 `no-root` with the standalone server → the build predates
  `sync-standalone.mjs` (static 404s) — rerun `npm run build`.
- Driver exits 2 (`accounts-error`) right after a deploy → check the worker is
  consuming: `curl http://127.0.0.1:9200/health` (component-aware), not
  `/api/health`.
