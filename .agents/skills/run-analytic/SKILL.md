---
name: run-analytic
description: Run, drive, and screenshot the analytic trading dashboard (Next.js web app). Use when asked to run the app, start the dashboard, take a screenshot, smoke-test the UI, or verify a dashboard/component change actually renders.
---

# Run: analytic dashboard

Next.js 16 App Router app. Driven headlessly via a small Playwright
script (`driver.mjs`) in this skill directory — no browser window, no
GUI toolkit. Paths below are relative to the repo root (`analytic/`).

## Prerequisites

Already satisfied in this repo checkout — `playwright` is a listed
dependency and its Chromium build is already downloaded
(`~/Library/Caches/ms-playwright/chromium-*`). If `driver.mjs` errors
with a missing-browser message, run `npx playwright install chromium`
once.

## Getting the app serving

This deployment runs the full stack via Docker Compose (`db`, `redis`,
`web`, `worker-v2`, `caddy` — see root `AGENTS.md`), reachable at
`http://localhost/`. Check it's up before driving it:

```bash
docker compose ps
curl -s -o /dev/null -w '%{http_code}\n' http://localhost/
```

`200` means it's already serving — most of the time it will be,
since this stack stays running. If it's down, bring it up per
`AGENTS.md`: `docker compose up -d` (not re-verified this session —
this is a live stack backing real trading accounts, don't restart it
casually; if it's already `Up`, leave it alone).

**This stack carries live production account data** — real names,
balances, positions. Treat it read-only: `nav` / `click-text` /
`screenshot` only. Never drive a write action (settings changes,
account mutation) against it without the user's explicit sign-off.

## Run (agent path)

`driver.mjs` reads newline commands from stdin or a script file and
runs from the **repo root** (so the `playwright` package resolves):

```bash
node .Codex/skills/run-analytic/driver.mjs <<'EOF'
nav http://localhost/
wait-for-text Airisa
screenshot /tmp/dashboard.png
click-text 1 สัปดาห์
wait 1500
screenshot /tmp/dashboard-week.png
console-errors
EOF
```

Verified this session: `nav` loaded the dashboard, `wait-for-text`
found a real account card, `click-text` switched the account's
timeframe tab (1 วัน → 1 สัปดาห์) and the panel re-rendered, and
`console-errors` came back `none`. Both screenshots showed live
account cards (name, `#login`, balance, GAIN/DD/PIPS/TRADES/OPENS
chips, balance sparkline).

Commands the driver supports:

| Command | Effect |
|---|---|
| `nav <url>` | Navigate, waits for network-idle |
| `wait <ms>` | Fixed pause (client-rendered data can lag network-idle) |
| `wait-for-text <text>` | Poll up to 15s for text to appear |
| `click-text <text>` | Click first element containing text |
| `screenshot <path>` | Save PNG |
| `viewport <w> <h>` | Resize (default 430×932 — mobile portrait, the primary target per `AGENTS.md`) |
| `console-errors` | Print collected `console.error`/`pageerror` output |

Default viewport is mobile portrait since that's this dashboard's
primary surface. For desktop/landscape checks, add a `viewport 1280
800` (or `viewport 932 430` for mobile landscape) line before `nav`.

## Gotchas

- **Run from repo root, not from inside the skill directory** —
  `driver.mjs` imports `playwright` via node_modules resolution;
  running it from elsewhere throws `ERR_MODULE_NOT_FOUND`.
- **Thai UI strings.** Timeframe tabs and most labels are Thai (`1
  วัน`, `1 สัปดาห์`, …), not English — `click-text` needs the exact
  Thai string, not a translated guess. See `AGENTS.md`/dashboard
  components for the current label set if it drifts.
- **`click-text` matches text anywhere on the page**, first match
  wins — with duplicate account names/timeframe labels across
  multiple cards it will hit the first one. Scope with more specific
  text (e.g. include the account number) if you need a later match.
- **A timeframe with no data renders "No balance curve for this
  timeframe."** — that's correct app behavior for an empty window,
  not a bug; don't mistake it for a broken chart.
- **No login/auth wall observed** on this deployment's `/` route —
  don't assume one needs to be scripted.
