# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working code this repo.

## What This Is

`analytic` — Next.js trading account monitor, MT5-style account data. Operational dashboard, not marketing site — built help operators spot which accounts matter most, track balance/equity curves, drill into performance no lost context. Optimized mobile (portrait/landscape) iOS Safari.

## Core Commands

```bash
npm run dev              # Next dev server
npm run build            # Required baseline verification for app changes
npm run start            # Run the production (standalone) build
npm run lint             # ESLint (Next.js defaults)

# Run a single test file directly (no package script needed)
node --import tsx --test src/lib/trading/analytics.test.ts
node --import tsx --test src/lib/trading/account-data.test.ts
node --import tsx --test src/lib/trading/equity-curve.test.ts
node --import tsx --test src/lib/trading/preaggregated-cache.test.ts
node --import tsx --test src/lib/trading/timeframe-route-contract.test.ts
node --import tsx --test src/lib/trading/core/growth.test.ts
node --import tsx --test src/lib/trading/core/downsample.test.ts
node --import tsx --test src/lib/trading/metric-registry.test.ts
node --import tsx --test src/lib/time.test.ts
node --import tsx --test src/lib/social.test.ts
node --import tsx --test src/worker/bridge-accounts.test.ts
node --import tsx --test src/worker/bridge-consumer.test.ts
node --import tsx --test src/worker/bridge-mapper.test.ts
node --import tsx --test src/worker/bridge-protocol.test.ts
node --import tsx --test src/worker/bridge-only-runtime.test.ts
node --import tsx --test src/worker/equity-sampler.test.ts
node --import tsx --test src/worker/economic-events-poller.test.ts
node --import tsx --test src/worker/health.test.ts
node --import tsx --test src/worker/history-checkpoint.test.ts
node --import tsx --test src/worker/history-migration.test.ts
node --import tsx --test src/app/page.test.ts
node --import tsx --test src/app/api/economic-events/route.test.ts
node --import tsx --test src/lib/economic-events/source.test.ts
node --import tsx --test src/components/trading-monitor/BotPnLPanel.test.ts
node --import tsx --test src/components/trading-monitor/card/DashboardCard.test.ts
node --import tsx --test src/components/trading-monitor/formatters.test.ts

# Opt-in integration test (needs RUN_HISTORY_RECOVERY_INTEGRATION=1 + live DB/Redis)
RUN_HISTORY_RECOVERY_INTEGRATION=1 node --import tsx --test src/worker/history-recovery.integration.test.ts

# Worker (bridge consumer + live sampling)
npm run worker           # Build + run continuously
npm run worker:dev       # Run via ts-node (no build)

npm run db:clean                     # Local data cleanup
node --import tsx scripts/set-broker-utc-offset.ts <accountNo> <offsetMinutes>  # Required per account before ingestion runs — see "Broker offset" below
node --import tsx scripts/set-broker-utc-offset.ts --list                      # List accounts + current offsets

# Full stack (local)
docker-compose up -d                 # Start all services: db, redis, web, worker, caddy

# Isolated test stack (db-test + redis-test only, separate ports/volumes from the dev stack)
npm run test:env:up      # Start db-test (localhost:5434) + redis-test (localhost:6380)
npm run test:env:down    # Stop and remove the test stack, including its volume

# Prisma
npx prisma migrate dev   # Apply migrations locally
npx prisma generate      # Regenerate client after schema edits
```

**Verification baseline:** No general end-to-end suite. `npm run build` + `npm run lint` are the standard checks. Run relevant `*.test.ts` files for logic changes. Bridge/Redis ingestion, history recovery, persistence, or analytics changes require the focused verification block below.

```bash
python3 -m pytest -q bridge_v2/tests
node --import tsx --test src/worker/*.test.ts src/lib/time.test.ts
npm run lint
npm run build:worker
npx tsc --noEmit
npm run build
```

For durable history recovery, also run the opt-in integration test against the isolated test DB/Redis stack when available.

## Architecture

**Stack:** Next.js 16 App Router + React 19, Redis 7 (cache/pub-sub), Prisma 6 + PostgreSQL 15, Node.js background worker, Caddy reverse proxy.

**Key directories:**

- `src/app/` — App Router pages, layouts, API routes
- `src/components/trading-monitor/` — Dashboard UI, formatters, account card logic, panels
- `src/lib/trading/` — Analytics engine, preaggregated cache views, report-result computation
- `src/lib/time.ts` — Bangkok-timezone utilities (Asia/Bangkok, UTC+7)
- `src/worker/` — Bridge stream consumer and live equity sampler (Node.js)
- `prisma/schema.prisma` + `prisma/migrations/`
- `scripts/` — Operational scripts (cleanup, backfill, remediation)
- `docs/` — Reference material for in-progress feature design docs (e.g. `emoji.pdf`)
- `design-system/trading-monitor/MASTER.md` — Design tokens single source of truth

**Data Path:** `MT5 API` → `Python Bridge` → `Redis Streams` / Redis live state → `Worker` (consume/sample) → `PostgreSQL`.

**Docker Compose stack:** `db` (postgres:15-alpine) → `redis` (redis:7-alpine) → `web` (Next.js) → `worker` (Node.js) → `caddy` (port 80).

## Data Model

Core tables (Prisma `@@map` exposes alternate SQL names — e.g. `TradingAccount` → `Account`):

- `TradingAccount` — Account metadata (accountNo, accountName, company, currency, serverName)
- `AccountSnapshot` — Current state (balance, equity, margin, marginLevel, floatingPl, creditFacility, freeMargin)
- `AccountReportResult` — Precomputed metrics cache (profitFactor, sharpeRatio, drawdowns, win stats, streaks)
- `Position` — Closed positions; unique on `(accountId, positionNo)`; includes `pips`
- `Deal` — All transactions; unique on `(accountId, dealNo)`; indexed on `time`
- `OpenPosition` — Active positions; unique on `(accountId, positionNo)` enables safe upsert
- `EquitySnapshot` — Intraday equity/margin samples (60s cadence) backing the 1D sparkline equity line
- `PositionExcursion` — Per-position P/L excursion samples captured alongside equity snapshots
- `BridgeHistoryCheckpoint` / `BridgeHistoryChunk` / `BridgeHistoryRecord` — Durable checkpoint state for automatic bounded history backfill across the Deal, Order, and closed-position stream contracts. A checkpoint advances only after all required stream barriers arrive, their counts/digests match, the complete chunk is durably persisted, and the PostgreSQL checkpoint transaction commits. See `src/worker/history-checkpoint.ts`.

**Source boundaries (critical — don't mix sources):**

- Win rate, profit factor, Sharpe, averaged metrics → `Position`
- Balance curve, growth, drawdown, intraday curves → `Deal`
- Floating P/L, open exposure, open counts → `OpenPosition` / `Redis`
- Latest balance, equity, margin, marginLevel → `AccountSnapshot` / `Redis`
- Intraday equity, margin load, runtime excursions → `EquitySnapshot` / `PositionExcursion`
- Trade P/L always `positionNetPnl = profit + swap + commission` (include swap + commission)

**Precomputed `AccountReportResult` cache, not authoritative source.**

## Key Conventions

**Code style:** 2-space indent, semicolons, double quotes, `@/` import aliases, `PascalCase` components/types, `camelCase` functions/hooks/variables.

**Number formatting:**

- Full currency: 2 decimals, currency symbol no space (`$1,234.57`, `-$1,234.57`)
- Compact monetary: no symbol, max 1 decimal, uppercase `K`/`M`/`B` suffixes, strip trailing `.0`
- Never mix compact and full currency same metric surface
- Backend keeps full precision; round only presentation layer

**Financial precision:** Use Prisma `Decimal` for monetary values worker/DB layer. Convert to `number` only at serialization boundary.

**Growth/analytics:** MQL5-style logic so deposits/withdrawals don't distort performance. Preserve balance-operation segmentation logic.

**Timezone:** PostgreSQL stores UTC timestamps only. Deal, Order, and Position timestamps arrive as raw MT5 broker-server time and are converted to UTC exactly once in the Node worker before persistence. Analytics and timeframe boundaries operate from UTC-backed data using shared utilities. `Asia/Bangkok` is used only for user-facing display and explicitly Bangkok-scoped calendar boundaries via `src/lib/time.ts`.

**Broker offset:** Deal/Order/Position timestamps arrive as broker-server time and are converted through `serverTimeToUtc(raw, account.brokerUtcOffsetMinutes)`. `TradingAccount.brokerUtcOffsetMinutes` is operator-managed and must be set before time-based ingestion is allowed. There is no automatic offset detection because the MT5 API does not expose a trustworthy broker GMT offset. Confirm the broker server offset, including any seasonal change, then set it with `scripts/set-broker-utc-offset.ts`.

If `brokerUtcOffsetMinutes` is null, ingestion for that account must fail clearly without acknowledging records or advancing its history checkpoint. The failure must be isolated to that account; correctly configured accounts must continue processing normally. New accounts onboarded through `ensureBridgeAccounts` start with `brokerUtcOffsetMinutes = null` and therefore cannot persist Deals, Orders, or closed Positions until configured.

Existing MT5-derived historical/runtime data predates this convention and is not repaired in place. The approved recovery path is: configure offsets for all accounts, back up PostgreSQL, delete affected MT5-derived historical/runtime data, clear history/backfill/dedupe state and derived caches, run the automatic full backfill from `2000-01-01`, then verify monthly coverage, duplicates, and UTC correctness.

**Account ordering:** Default sort `Growth` `1D` descending. Tie-breakers: `Pips` `1D`, then balance desc, then accountNo asc.

**Zero-as-empty pattern:** `kpiValue(v)` converts `0 | null | undefined → null` so formatters output `"-"` instead `"0"`. Use at KPI chip layer; don't pass raw 0 to display formatters.

## History Backfill and Durability

- Missing history cursor plus no completed durable checkpoint means the account requires automatic full-history backfill from `2000-01-01`; never fall back silently to `now - 30 days`.
- Backfill runs in bounded, configurable date chunks and resumes from the last PostgreSQL-confirmed checkpoint after interruption.
- Publishing a chunk to Redis does not constitute completion. Progress advances only after the Node worker has durably persisted the complete chunk and the PostgreSQL checkpoint transaction has committed.
- Redis is transport and a coordination mirror, not the authoritative source of backfill completion. Durable state must be reconstructable from PostgreSQL after Redis loss.
- Empty windows must be recorded as completed so historical coverage can be proven gap-free.
- Replay must be idempotent for Deals, Orders, closed Positions, barriers, and acknowledgments.
- Live polling may continue while backfill runs, but the backfill state machine must prevent gaps, premature cursor advancement, and duplicate persistence.
- Once full backfill reaches the present and is marked complete, the account switches to forward-only incremental history sync. A missing cursor after durable completion must be reconstructed safely from PostgreSQL or fail loudly; never reintroduce the 30-day fallback.

## UI Stack

- **framer-motion** — Primary animation layer: expand/collapse panels, drag handles, entrance transitions. All variant objects live `src/lib/animations.ts` — always `...spread` into motion props; don't inline variant values.
- **ApexCharts / react-apexcharts** — Balance/equity charts; `dynamic` import required (SSR unsafe)
- **Chart.js / react-chartjs-2** — Secondary charts
- **Fonts:** Sarabun + Noto Sans Thai (Thai body), Bai Jamjuree (numeric mono), loaded via `@fontsource/*`
- **PWA:** Standalone mode applies `env(safe-area-inset-top)` for status bar; scroll content intentionally full-bleed
- **Design tokens:** Single source of truth `design-system/trading-monitor/MASTER.md` — surfaces, accent palette, semantic colors, typography, radius, motion timing. Don't copy token values inline; reference doc instead. Avoid Tailwind color defaults (`green-500`, `red-400`) — use semantic tokens.

## Dashboard Layout Model

Dashboard answers three questions fast: which accounts matter most, what balance/equity curve doing, where drill next no lost context.

- **Mobile landscape:** Two-zone account workspace; balance chart dominant.
- **Mobile portrait:** Single-column stack; compact header; dense KPI grid.
- **Real-time:** Live equity beacon (ring with heartbeat blink) indicates WebSocket activity.

**Required KPI chips:** net gain, relative drawdown, pips, total trades, open positions.

## Environment Variables

Key ones (no `.env.example` currently in-tree; use `.env.test.example` as reference local/test values):

- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `RUN_DB_MIGRATIONS` — Auto-migrate on web container startup
- `WORKER_POLL_MS` — Poll interval ms (default: 150000)
- `WORKER_HEALTH_PORT` — Port for worker heartbeat HTTP endpoint (`GET /health`); set `0` disable (default: 9100)
- `WORKER_HEALTH_STALE_MS` — Time since last poll activity before `/health` returns 503 (default: `WORKER_POLL_MS * 2 + 60000`)
- `REDIS_PASSWORD` — Required; `docker-compose.yml` fails startup if unset (Redis port exposed publicly)

**Isolated test stack:** `docker-compose.test.yml` runs `db-test` (localhost:5434) and `redis-test` (localhost:6380) own project name, ports, volume — safe run alongside main `docker-compose.yml` stack no collision. `npm run test:env:up` / `npm run test:env:down` load config via `--env-file .env.test`, auto-bootstrapping `.env.test` from `.env.test.example` first run — edit `.env.test` directly customize ports/credentials/`DATABASE_URL`/`REDIS_URL`.

## Known Follow-up

- **BridgeHistoryRecord column mapping:** Verify `BridgeHistoryRecord.chunkId` in `prisma/schema.prisma` against the existing PostgreSQL column `chunk_id`. Do not accept an automatically generated Prisma migration for this field until the schema mapping, current database column, constraints, and existing data have been inspected. Keep this follow-up separate from the history/timezone rebuild.

## Agent Workflow Notes

- Check worktree before editing — repo may have unrelated local experiments.
- Dashboard work starts `src/components/trading-monitor/`, `src/app/globals.css`, account API routes.
- Account API: `GET /api/accounts` (account list with snapshots); `GET /api/accounts/[id]?timeframe=...` (account detail with positions/deals).
- Economic calendar API: `GET /api/economic-events?scope=expanded` returns 30-day window; default scope returns today + nearest week. Forex Factory source, Bangkok time, `force-dynamic`.
- Health check: `GET /api/health`.
- Update `AGENTS.md` for UI direction/layout changes; update `CLAUDE.md` for workflow, command, or stack changes.
- **Before every `git push`:** ask user confirm `package.json` `version` bump (`x.x` format, e.g. `7.0` → `7.1`) apply same commit being pushed.
