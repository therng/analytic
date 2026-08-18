---
name: run-analytic
description: Run, launch, probe, and screenshot the analytic trading dashboard (Next.js web app) on this Windows host. Use when asked to run or start the app, open or check the dashboard, take a screenshot of it, verify the web tier after a change or deploy, or smoke-test the app. Covers starting the web server against the on-host PostgreSQL 18 + WSL Redis, curl API probes, and the Playwright screenshot driver.
---

# run-analytic — launch and drive the analytic dashboard

Next.js 16 trading-account monitor, repo `C:\analytic`. On this host (forexvps / `analyticVPS`, Windows Server 2022) the web app is **not yet an NSSM service** — you launch it from the checkout. The data plane is already native here: PostgreSQL 18 (`postgresql-x64-18` service, `127.0.0.1:5432`, db `trading_db`, role `supachai`) and Redis in WSL2 (`127.0.0.1:6379`).

The agent path is one command — `smoke.sh` starts the server if none is running, probes the APIs, screenshots the dashboard with the Playwright driver (`driver.mjs`, system Chrome), and stops only a server it started itself.

All paths below are relative to the repo root (`C:\analytic`). Everything here was executed and verified on this host, 2026-08-18.

## Prerequisites (already satisfied on this host)

- Node 24 (nvm4w) on PATH; `node_modules/` installed; Prisma client generated (`npx prisma generate` after schema pulls)
- `.env` at repo root — dotenv format, **one variable per line**: `DATABASE_URL`, `REDIS_URL`, `TZ`
- System Chrome or Edge at the default Program Files path — the driver launches `channel: "chrome"` (Edge fallback). Playwright ships as a repo dependency; bundled browsers were never downloaded here and are not needed
- A production build in `.next/` (see Build)

## Build

```bash
npm run build          # ~2–3 min on this host; regenerates .next (incl. incomplete standalone/, see Gotcha 2)
```

Before rebuilding, make sure no server is still running (Gotcha 3), or the build dies with `EBUSY: resource busy or locked, rmdir 'C:\analytic\.next\standalone'`:

```bash
wmic process where "name='node.exe'" get processid,commandline   # any next/server trees alive? kill them first
```

## Run (agent path)

One-shot smoke (start if needed → probe → screenshot → stop what it started):

```bash
bash .claude/skills/run-analytic/smoke.sh
# -> [smoke] GET /api/health -> 200 / GET /api/accounts -> 200
# -> JSON state line from driver.mjs, screenshots in .claude/skills/run-analytic/shots/
# exit 0 = rendered (cards or clean empty), 2 = accounts-error, 3 = server/build broken
```

Flags pass through to the driver: `--viewport portrait|landscape|desktop` (default portrait — the app's primary surface), `--click-first` (tap first account card — only acts when accounts exist), `--settle-ms N` (how long to wait for cards before calling it empty, default 15000).

If the server is already running, smoke.sh detects it and **leaves it running**.

Manual, when you want the server to stay up:

```bash
npx next start -p 3000 -H 127.0.0.1        # loopback-only; background it
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/health     # 200 (static ok — proves nothing about DB)
curl -s http://127.0.0.1:3000/api/accounts                                     # 200 + JSON array; fresh DB -> []
node .claude/skills/run-analytic/driver.mjs --click-first                      # screenshots + JSON state summary
```

Stopping it — resolve the real PID from the port and force-kill, or the node server outlives the shell that spawned it:

```bash
netstat -ano | grep '127.0.0.1:3000' | grep LISTENING     # PID is the last column
taskkill //F //T //PID <pid>
```

### Reading driver output

- `state: "accounts"` — cards rendered; `--click-first` also screenshots the first card opened (drill path not yet exercised with real data on this host — dashboard had no accounts as of 2026-08-18)
- `state: "empty-or-loading"` — candle animation on black, footer "Analytic <version>". Legit empty state when the DB has no accounts (worker-v2 not ingesting). Verify the footer version matches `package.json` to prove you're on the build you expect
- `state: "accounts-error"` — page shows "Accounts unavailable": DB/env problem → Troubleshooting
- `state: "no-root"` — server up but `main.monitor-page` never rendered: broken build or proxy page

## Run (human path)

```bash
npm run dev              # dev server, hot reload; 200 on / and /api/accounts on this host
```

Stop with Ctrl-C **and then** the port-PID kill above — the dev tree (npm → next dev → start-server) survives the shell too.

Do **not** use `npm run start`: it runs `.next/standalone/server.js`, but `output: standalone` here never copies `.next/static/` or `public/` into it — the HTML loads (200) while its own CSS/JS 404, so the page renders broken. Verified by serving it and curling a referenced `/_next/static/*` asset → 404.

## Gotchas (all hit on this host, 2026-08-18)

1. **`.env` collapsed to a single line** — all vars space-separated on one line, so dotenv reads `trading_db REDIS_URL=... TZ=...` as the database name. Symptom: `Database credentials were rejected for 127.0.0.1:5432/trading_db%20REDIS_URL=...`. Fix: one var per line. (The file had also picked up a trailing `\r` — strip CRs too.)
2. **Standalone build is incomplete** — see human path. `npx next start` is the working server command.
3. **Servers orphan on kill** — killing the bash/npm wrapper leaves the node tree alive. Two symptoms: next launch dies instantly with EADDRINUSE while the *old* server keeps serving *stale env* (looks like "my env fix didn't work" — it did, you're curling a zombie); and `npm run build` fails EBUSY on `.next\standalone`. Always kill by port PID with `//F //T`, and check `wmic ... get processid,commandline` for strays (dev tree = `npm run dev` → `next dev` → `start-server.js`; prod tree = `npm run start` → `.next/standalone/server.js`).
4. **PG18 owns port 5432** — the migration plan's audit line "PG18 at port 5433" is stale. PG16 is installed but STOPPED and configured for the *same* port 5432 — never start `postgresql-x64-16`.
5. **No docker on this host** — `docker compose ...`, `npm run test:env:up` are dev-machine paths; they don't exist here.
6. **No bundled Playwright browsers** — `npx playwright install` was never run; the repo's own `touch-targets.test.ts` shows a ✖ for this reason (suite still exits 0). The skill driver doesn't care — it uses system Chrome.
7. **`psql -c` does not interpolate `:'var'`** — variable interpolation needs stdin. For password-safe SQL, pipe a heredoc: `psql -v pw=... <<'SQL' ... PASSWORD :'pw'; SQL`.
8. **Prisma error bodies embed DATABASE_URL with the password** — never paste raw `/api/accounts` error JSON into chat or files; mask first.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `credentials were rejected for ...trading_db%20REDIS_URL=...` | `.env` single-line (Gotcha 1) — split vars onto lines |
| `credentials were rejected for 127.0.0.1:5432/trading_db` | postgres service down, or password mismatch. `trading_db` + role `supachai` exist (provisioned 2026-08-18 per migration plan Task 3 Step 2); check `sc query postgresql-x64-18` |
| new server exits instantly / curl still answers after "fixing" env | zombie server on 3000 (Gotcha 3) — kill by port PID |
| `npm run build` → `EBUSY rmdir .next\standalone` | server tree still alive holding `.next` (Gotcha 3) |
| screenshot = black + candles | not a failure — empty dashboard until worker-v2 ingests (see below) |
| `psql: syntax error at or near ":"` | Gotcha 7 |

## Test

```bash
npm run test                                                   # unit suite; exits 0 (touch-targets ✖ is Gotcha 6)
node --import tsx --test src/components/trading-monitor/touch-targets.test.ts   # single file
```

## Context: data and the worker (not this skill's job)

An empty dashboard is correct until worker-v2 ingests (bridge → Redis → worker → Postgres). **Don't start worker-v2 casually from this skill** — it writes to the production DB and double-running risks duplicate ingestion; that belongs to the migration plan / `mt5-bridge-engineer` domain. The real pipeline probe is the worker's component-aware `http://127.0.0.1:9200/health` (not `/api/health`, which is static). Deploys on this host follow `.claude/skills/ssh-vps/references/deploy.md`.
