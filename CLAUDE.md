# CLAUDE.md

Guidance for Claude Code (claude.ai/code) work in this repo.

## What This Is

`analytic` — Next.js trading account monitor, MT5-style account data. Operational dashboard, not marketing site — built help operators spot which accounts matter most, track balance/equity curves, drill into performance no lost context. Optimized mobile (portrait/landscape) iOS Safari.

Deeper reference material:

- `docs/ARCHITECTURE.md` — bridge architecture spec and invariants (broker-time opacity, UTC separation, SQLite authority, fencing)
- `docs/decisions/` — ADRs 0001–0005 (native bridge greenfield, worker-v2 adoption, Redis live transport, FTP import deprecation, bridge single-owner model)
- `docs/incidents/` — postmortem records
- `docs/architecture-data-models.md` — living per-model reference for `prisma/schema.prisma` (check before the Data Model summary below)
- `CHANGELOG.md` — release history
- `docs/superpowers/plans/` — implementation plans in flight, e.g. `2026-08-17-windows-single-host-migration.md` (active migration onto the single forexvps Windows host)

## Harness: analytic-harness

Repo-local harness lives at `.claude/skills/analytic-harness/SKILL.md`, with routing and handoff rules in `docs/harness/analytic/team-spec.md`. (`.claude/skills/harness/SKILL.md` is the separate meta-skill for *designing* harnesses — not the entry point for making changes. `.agents/skills/*` are committed symlinks to the same targets — they resolve on POSIX checkouts but materialize as dead text files on Windows, so prefer the `.claude/skills/` paths.)

Use it for non-trivial fixes or features involving trading analytics, Bridge/Redis/Postgres ingestion, Prisma contracts, or responsive dashboard behavior. Answer simple questions directly. Select only the affected domain reviewers:

- `.claude/skills/trading-analytics-review/SKILL.md`
- `.claude/skills/bridge-ingestion-review/SKILL.md`
- `.claude/skills/dashboard-responsive-review/SKILL.md`

`.claude/agents/` holds the active Claude Code subagent set for this repo — invoke via the Agent tool by name, don't hand-roll the equivalent work inline:

- Domain reviewers (read-only, mirror the skills above): `trading-analytics-reviewer`, `bridge-ingestion-reviewer`, `dashboard-responsive-reviewer`, plus `architecture-reviewer` for cross-cutting/ownership decisions.
- Domain builders: `backend-engineer` (`src/app/api/`, `src/lib/trading/`), `frontend-engineer` (`src/components/trading-monitor/`, dashboard CSS), `mt5-bridge-engineer` (`bridge/`, `src/worker-v2/`), `prisma-engineer` (`prisma/schema.prisma`, migrations), `redis-engineer` (non-MT5-envelope Redis usage), `infrastructure-engineer` (Compose/Caddy/env), `test-engineer` (test coverage + verification baseline), `release-engineer` (version bump + pre-push gate).
- Diagnostician: `pipeline-health-engineer` (read-only) triages stale dashboard data, `journal_failure`, worker crash-loop, and pre/post-VPS-restart checks, then hands off to the owning builder — it never applies a fix itself.
- Coordinator: `orchestrator` — autonomous routing for multi-step/cross-domain work (context gathering, delegation, evidence-based verification); for single-domain tasks go straight to the domain engineer.

Each agent file names its own boundary and hands off to the correct neighbor on overlap — see the `description` frontmatter in `.claude/agents/*.md`. `_workspace/` durable handoffs remain supported and are what `scripts/check-harness-review.sh` accepts as review evidence; worktrees stay opt-in, not default.

## Core Commands

```bash
npm run dev              # Next dev server
npm run build            # Required baseline verification for app changes
npm run test             # Whole-repo unit suite (src/**/*.test.ts via node --test) — CI baseline
npm run start            # Run the production (standalone) build
npm run lint             # ESLint (Next.js defaults)

# Run a single test file directly (no package script needed)
node --import tsx --test src/lib/trading/analytics.test.ts
node --import tsx --test src/lib/trading/account-data.test.ts
node --import tsx --test src/lib/trading/equity-curve.test.ts
node --import tsx --test src/lib/trading/preaggregated-cache.test.ts
node --import tsx --test src/lib/trading/trade-history.test.ts
node --import tsx --test src/lib/trading/position-excursion.test.ts
node --import tsx --test src/lib/trading/timeframe-route-contract.test.ts
node --import tsx --test src/lib/trading/core/downsample.test.ts
node --import tsx --test src/lib/trading/pull-to-refresh-lock.test.ts
node --import tsx --test src/lib/trading/metric-registry.test.ts
node --import tsx --test src/lib/time.test.ts
node --import tsx --test src/lib/social.test.ts
node --import tsx --test src/lib/redis-mt5.time.test.ts
node --import tsx --test src/lib/trading/analytics/xauusd-margin.test.ts
node --import tsx --test src/lib/trading/preaggregated/balance-curve-24h.test.ts
node --import tsx --test src/lib/trading/report-view-cache.test.ts
node --import tsx --test src/worker-v2/*.test.ts
node --import tsx --test src/worker-v3/**/*.test.ts
node --import tsx --test src/app/page.test.ts
node --import tsx --test src/app/safe-area.test.ts
node --import tsx --test src/app/api/economic-events/route.test.ts
node --import tsx --test src/lib/economic-events/source.test.ts
node --import tsx --test src/components/trading-monitor/BotPnLPanel.test.ts
node --import tsx --test src/components/trading-monitor/TradeHistoryPanel.test.ts
node --import tsx --test src/components/trading-monitor/PerformanceBars.test.ts
node --import tsx --test src/components/trading-monitor/TradeDistributionPanel.test.ts
node --import tsx --test src/components/trading-monitor/trade-distribution-chart.test.ts
node --import tsx --test src/components/trading-monitor/drawdown-chart.test.ts
node --import tsx --test src/components/trading-monitor/MonitorShared.test.ts
node --import tsx --test src/components/trading-monitor/touch-targets.test.ts
node --import tsx --test src/lib/trading/trade-distributions.test.ts
node --import tsx --test src/components/trading-monitor/card/DashboardCard.test.ts
node --import tsx --test src/components/trading-monitor/formatters.test.ts

# covers reconstruct-position-adapter against a real checkpoint transaction. Needs
# RUN_WORKER_V2_HISTORY_INTEGRATION=1 + npm run test:env:up (db-test:5434, redis-test:6380)
RUN_WORKER_V2_HISTORY_INTEGRATION=1 node --import tsx --test src/worker-v2/history-checkpoint.integration.test.ts

# Worker V2 (history, live state, equity sampling, calendar)
npm run worker-v2
npm run worker-v2:dev

npm run db:clean                                                       # Local data cleanup
node --import tsx scripts/set-broker-utc-offset.ts <accountNo> <offsetMinutes>  # Required per account before ingestion runs
node --import tsx scripts/set-broker-utc-offset.ts --list                      # List accounts + current offsets
python -m bridge.scripts.replay_published_outbox --journal <journal.sqlite3> --login <login> --target-id <recovery-target> --confirm REPLAY_PUBLISHED_OUTBOX # Replays retained native PUBLISHED history to a verified clean Redis target; source SQLite remains read-only

# Full stack (local)
docker compose up -d                 # LOCAL DEV stack only: db, redis, web, worker-v2, caddy (production = forexvps native services)
docker compose stop web              # Free port 3000 before npm run dev outside the web container

# Isolated test stack (db-test + redis-test only, separate ports/volumes from the dev stack)
npm run test:env:up      # Start db-test (localhost:5434) + redis-test (localhost:6380)
npm run test:env:down    # Stop and remove the test stack, including its volume

# Prisma
npx prisma migrate dev   # Apply migrations locally
npx prisma generate      # Regenerate client after schema edits
```

**Verification baseline:** No general end-to-end suite. `npm run build` + `npm run lint` standard checks. Run relevant `*.test.ts` files for logic changes. Bridge/Redis ingestion, history recovery, persistence, analytics changes require focused verification block below.

```bash
# bridge/ deps aren't in requirements.txt's MetaTrader5/Windows-only chain —
# install requirements-dev.txt once (e.g. into a throwaway venv) before this
python3 -m pytest -q bridge/tests
node --import tsx --test src/worker-v2/*.test.ts src/lib/time.test.ts
npm run lint
npm run build:worker-v2
npx tsc --noEmit
npm run build
```

For durable history recovery, also run opt-in integration test against isolated test DB/Redis stack when available.

## Architecture

**Stack:** Next.js 16 App Router + React 19, Redis 7 (cache/pub-sub), Prisma 6 + PostgreSQL 18, Node.js background worker, Caddy reverse proxy.

**Key directories:**

- `src/app/` — App Router pages, layouts, API routes
- `src/components/trading-monitor/` — Dashboard UI, formatters, account card logic, panels
- `src/lib/trading/` — Analytics engine, preaggregated cache views, report-result computation
- `src/lib/time.ts` — Bangkok-timezone utilities (Asia/Bangkok, UTC+7)
- `src/worker-v2/` — sole Node worker: durable Deal/Order/Position ingestion, account provisioning, live state, equity/excursion sampling, economic calendar, and component health
- `src/worker-v3/` — Scaffolding only (`aggregations/`, `mappers/`, `processors/`, `validators/`); no docker-compose service or npm script yet
- `prisma/schema.prisma` + `prisma/migrations/`
- `scripts/` — Operational scripts (cleanup, backfill, remediation)
- `docs/` — Reference material for in-progress feature design docs (e.g. `mql5book.pdf`, `analytic-principles.pdf`); `docs/architecture-data-models.md` living per-model reference for `prisma/schema.prisma` — check before Data Model section below for anything deeper than summary
- `design-system/trading-monitor/MASTER.md` — Design tokens single source of truth

**Data Path:** `MT5 API` → `Python Bridge` → `Redis Streams` / Redis live state → `Worker` (consume/sample) → `PostgreSQL`.

**Local dev stack (Docker Compose):** `db` (postgres:16-alpine) → `redis` (redis:7.2-alpine) → `web` (Next.js) → `worker-v2` (Node.js) → `caddy` (port 80).

**Production (forexvps — Windows Server 2022, single host):** native Windows services — `postgresql-x64-18` + `redis-wsl` (Redis 7.2 in WSL2) + `analytic-web` + `analytic-worker` + `caddy` (sole public exposure, `https://therng.duckdns.org`) alongside the MT5 terminals and the `bridge` NSSM service. Data plane is loopback-only. Ops runbook: `.claude/skills/ssh-vps/` (status checks, deploys, restarts, post-reboot recovery). Migration design/plan: `docs/superpowers/{specs,plans}/2026-08-17-windows-single-host-migration*.md`.

## Data Model

Core tables (Prisma `@@map` exposes alternate SQL names — e.g. `TradingAccount` → `Account`):

- `TradingAccount` — Account metadata (accountNo, accountName, company, currency, serverName)
- `AccountSnapshot` — Current state (balance, equity, margin, marginLevel, floatingPl, creditFacility, freeMargin)
- `AccountReportResult` — Precomputed metrics cache (profitFactor, sharpeRatio, drawdowns, win stats, streaks)
- `Position` — Closed positions; unique on `(accountId, positionNo)`; includes `pips`
- `Deal` — All transactions; unique on `(accountId, dealNo)`; indexed on `time`
- `Order` — Order records backing history sync (worker-v2 ingestion via `bridge/`); unique on `(accountId, orderTicket)`
- `OpenPosition` — Active positions; unique on `(accountId, positionNo)` enables safe upsert
- `EquitySnapshot` — Intraday equity/margin samples (60s cadence) backing 1D sparkline equity line
- `PositionExcursion` — Per-position P/L excursion samples captured alongside equity snapshots
- `BridgeHistoryCheckpoint` / `BridgeHistoryChunk` / `BridgeHistoryRecord` —     Legacy recovery tables retained only for manual recovery. The active ingestion pipeline does not read or write these tables during normal operation. The native bridge owns all history backfill and coverage state, while Worker V2 only persists incoming history events idempotently using the existing unique constraints. src/worker-v2/history-checkpoint.ts is retained solely as the transaction/reconstruction building block these legacy tables need (no standalone manual-reset CLI anymore — removed as ineffective since the bridge's own SQLite journal owns backfill/coverage state). Do not treat these tables as part of the live runtime state.

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

**Account ordering:** Default sort `Growth` `1D` descending. Tie-breakers: `Pips` `1D`, then `Trades` `1D` (today's closed-position count), then balance desc, then accountNo asc.

**Zero-as-empty pattern:** `kpiValue(v)` normalizes `null | undefined → null` so formatters output `"-"` for missing values; zero metrics are preserved (0 renders as a formatted zero). Apply at the KPI chip layer; where zero means empty, convert per-metric at the call site (e.g. `formatCompactCount(openCount || null)`).

## History Backfill and Durability

- Missing history cursor plus no completed durable checkpoint means account requires automatic retained-history backfill from `2025-01-01`; never fall back silently to `now - 30 days`.
- Backfill runs in bounded, configurable date chunks and resumes from last PostgreSQL-confirmed checkpoint after interruption.
- Publishing chunk to Redis not completion. Progress advances only when the bridge's SQLite journal durably records the completed window and the Node worker has durably persisted the complete chunk (idempotent upserts). Backfill/coverage bookkeeping is owned by the bridge SQLite journal, not PostgreSQL checkpoints.
- Redis transport and coordination mirror, not authoritative source of backfill completion. Durable state must be reconstructable from PostgreSQL after Redis loss.
- Empty windows must be recorded as completed so historical coverage can be proven gap-free.
- Replay must be idempotent for Deals, Orders, closed Positions, barriers, acknowledgments.
- Live polling may continue while backfill runs, but backfill state machine must prevent gaps, premature cursor advancement, duplicate persistence.
- Once full backfill reaches present and marked complete, account switches to forward-only incremental history sync. Missing cursor after durable completion must be reconstructed safely from PostgreSQL or fail loudly; never reintroduce 30-day fallback.

## UI Stack

- **framer-motion** — Primary animation layer: expand/collapse panels, drag handles, entrance transitions. All variant objects live `src/lib/animations.ts` — always `...spread` into motion props; don't inline variant values.
- **ApexCharts / react-apexcharts** — Balance/equity charts; `dynamic` import required (SSR unsafe)
- **Fonts:** Sarabun + Noto Sans Thai (Thai body), Bai Jamjuree (numeric mono), loaded via `@fontsource/*`
- **PWA:** Standalone mode applies `env(safe-area-inset-top)` for status bar; scroll content intentionally full-bleed
- **Design tokens:** Single source of truth `design-system/trading-monitor/MASTER.md` — surfaces, accent palette, semantic colors, typography, radius, motion timing. Don't copy token values inline; reference doc instead. Avoid Tailwind color defaults (`green-500`, `red-400`) — use semantic tokens.

## Dashboard Layout Model

Dashboard answers three questions fast: which accounts matter most, what balance/equity curve doing, where drill next no lost context.

- **Mobile landscape:** Two-zone account workspace; balance chart dominant.
- **Mobile portrait:** Single-column stack; compact header; dense KPI grid.
- **Real-time:** Live equity beacon (ring with heartbeat blink) indicates fresh polled Redis live state (2s HTTP poll; there is no WebSocket transport).

**Required KPI chips:** net gain, relative drawdown, pips, total trades, open positions.

## Environment Variables

Key ones (no `.env.example` currently in-tree; use `.env.test.example` as reference local/test values):

- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `RUN_DB_MIGRATIONS` — Auto-migrate on web container startup
- `WORKER_V2_HEALTH_PORT` — Component-aware health endpoint port (default: 9200)
- `WORKER_V2_ENABLE_LIVE_SYNC` — `AccountSnapshot`/`OpenPosition` writer toggle; defaults true, set false only for rollback
- `WORKER_V2_HISTORY_TX_TIMEOUT_MS` — Durable barrier/reconstruction transaction timeout (default: 60000)
- `WORKER_V2_EQUITY_SAMPLE_MS` / `WORKER_V2_EQUITY_RETENTION_DAYS` — equity cadence (60000 ms) and retained closed snapshot window (7 days)
- `WORKER_ECONOMIC_EVENTS_POLL_MS` — Forex Factory poll cadence (default: 3600000)
- `REDIS_PASSWORD` — Required for the local Compose stack (fails startup if unset; Redis port exposed publicly there). Production Redis on forexvps is loopback-only behind `requirepass`.
- `DUCKDNS_TOKEN` — Required for the HTTPS `therng.duckdns.org` Caddy site; the HTTP site remains available without it

**Isolated test stack:** `docker-compose.test.yml` runs `db-test` (localhost:5434) and `redis-test` (localhost:6380) own project name, ports, volume — safe run alongside main `docker-compose.yml` stack no collision. `npm run test:env:up` / `npm run test:env:down` load config via `--env-file .env.test`, auto-bootstrapping `.env.test` from `.env.test.example` first run — edit `.env.test` directly customize ports/credentials/`DATABASE_URL`/`REDIS_URL`.

## Agent Workflow Notes

- Check worktree before editing — repo may have unrelated local experiments.
- **Worker V2 is the sole active Node worker:** it owns account provisioning, durable Deal/Order/Position ingestion, `AccountSnapshot`/`OpenPosition`, `EquitySnapshot`/`PositionExcursion`, and economic events. The retired `src/worker/` runtime and Compose service must not be reintroduced. `src/worker-v3/` remains scaffolding only. It consumes the native bridge (`bridge/`) contract directly: `mt5:account:{login}:live` and `mt5:account:{login}:stream:history` (see `src/worker-v2/history-consumer.ts`, `src/worker-v2/live-sync.ts`). Backfill/coverage bookkeeping is owned entirely by the bridge's own SQLite journal now, not the worker or PostgreSQL.
- Dashboard work starts `src/components/trading-monitor/`, `src/app/globals.css`, account API routes.
- Account API: `GET /api/accounts` (account list with snapshots); `GET /api/accounts/[id]?timeframe=...` (account detail with positions/deals); `GET /api/accounts/[id]/trade-history` (cursor-paginated trade history).
- Economic calendar API: `GET /api/economic-events?scope=expanded` returns 30-day window; default scope returns today + nearest week. Forex Factory source, Bangkok time, `force-dynamic`.
- Health check: `GET /api/health` (static `{ok:true}` — proves nothing about DB/Redis; the real pipeline probe is worker-v2 `:9200/health`, component-aware).
- **Production deploys**: `git pull` on `C:\analytic` + on-host rebuild (`npm ci` → `npx prisma generate` → `npm run build` → `npm run build:worker-v2` → `npx prisma migrate deploy` when migrations changed) + restart only the services the diff touched (`nssm restart`). `entrypoint.sh` auto-migrate applies to the local Compose web container only — production migrates at deploy time.
- Update `AGENTS.md` for UI direction/layout changes; update `CLAUDE.md` for workflow, command, or stack changes.
- **Before every `git push`:** ask user confirm `package.json` `version` bump (`x.x` format, e.g. `7.0` → `7.1`) apply same commit being pushed.
- **Harness review enforcement:** `scripts/check-harness-review.sh` runs as a pre-push hook (install once per clone with `npm run hooks:install`; run ad hoc with `npm run harness:check`). Blocks a push that touches an ingestion/analytics/dashboard domain path (per `docs/harness/analytic/team-spec.md` routing table) unless a commit in the push pairs `<domain> review: pass` with a domain-path diff, or the canonical artifact `_workspace/02_review_{domain}.md` was added/updated within the push (stale committed artifacts never count; suffixed historical records go under `_workspace/review-log/`). Also blocks any push adding a hardcoded `REDIS_PASSWORD`/`DATABASE_URL`/`DUCKDNS_TOKEN` literal or a stray `.env*` file (`.env.example`/`.env.test.example` are allowed).
