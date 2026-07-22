# CLAUDE.md

Guidance for Claude Code (claude.ai/code) work in this repo.

## What This Is

`analytic` — Next.js trading account monitor, MT5-style account data. Operational dashboard, not marketing site — built help operators spot which accounts matter most, track balance/equity curves, drill into performance no lost context. Optimized mobile (portrait/landscape) iOS Safari.

## Harness: analytic-harness

Goal: coordinated locate-edit-review flow across trading-analytics / bridge-worker-ops / dashboard-ui domains, cavecrew subagents for locate/edit/review, domain expert reviewer for correctness.

Trigger: fix/change work scoped to domain, or "run the harness" → `analytic-harness` skill. Simple questions answer direct.

Change log:
| Date | Change | Target | Reason |
|---|---|---|---|
| 2026-07-18 | Initial build | `.claude/agents/general-purpose.md`, `.claude/skills/analytic-harness/` | User requested harness across all domains, cavecrew mode |
| 2026-07-18 | model haiku, effort medium for all Agent calls | `.claude/skills/analytic-harness/SKILL.md` | User request, cost/speed tuning |
| 2026-07-18 | added `planner` agent (opus, high effort), wired as step 3 between domain-check and build | `.claude/agents/planner.md`, `.claude/skills/analytic-harness/SKILL.md` | User request, ordered multi-file plans before builder touches code |
| 2026-07-22 | ported `financial-data-reviewer`, `analytics-formula-reviewer`, `prisma-migration-reviewer` from stale Codex-format definitions (found only as `.codex/agents/*.toml` in old worktree) into `.claude/agents/*.md`; fixed `dashboard-ui` row's reviewer name from nonexistent `ui-mobile-reviewer` to actual agent `ui-mobile` | `.claude/agents/financial-data-reviewer.md`, `.claude/agents/analytics-formula-reviewer.md`, `.claude/agents/prisma-migration-reviewer.md`, `.claude/skills/analytic-harness/SKILL.md` | SKILL.md referenced 4 domain reviewer agents; 3 non-UI ones didn't exist as Claude Code subagents, UI one had wrong name — harness run outside dashboard-ui would've failed domain-check step |

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
node --import tsx --test src/lib/trading/trade-history.test.ts
node --import tsx --test src/lib/trading/position-excursion.test.ts
node --import tsx --test src/lib/trading/timeframe-route-contract.test.ts
node --import tsx --test src/lib/trading/core/downsample.test.ts
node --import tsx --test src/lib/trading/pull-to-refresh-lock.test.ts
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
node --import tsx --test src/worker-v2/*.test.ts
node --import tsx --test src/worker-v3/**/*.test.ts
node --import tsx --test src/app/page.test.ts
node --import tsx --test src/app/api/economic-events/route.test.ts
node --import tsx --test src/lib/economic-events/source.test.ts
node --import tsx --test src/components/trading-monitor/BotPnLPanel.test.ts
node --import tsx --test src/components/trading-monitor/TradeHistoryPanel.test.ts
node --import tsx --test src/components/trading-monitor/PerformanceBars.test.ts
node --import tsx --test src/components/trading-monitor/TradeDistributionPanel.test.ts
node --import tsx --test src/components/trading-monitor/trade-distribution-chart.test.ts
node --import tsx --test src/lib/trading/trade-distributions.test.ts
node --import tsx --test src/components/trading-monitor/card/DashboardCard.test.ts
node --import tsx --test src/components/trading-monitor/formatters.test.ts

# Opt-in integration test (needs RUN_HISTORY_RECOVERY_INTEGRATION=1 + live DB/Redis)
RUN_HISTORY_RECOVERY_INTEGRATION=1 node --import tsx --test src/worker/history-recovery.integration.test.ts

# Worker (bridge consumer + live sampling)
npm run worker           # Build + run continuously
npm run worker:dev       # Run via ts-node (no build)

npm run db:clean                     # Local data cleanup
node --import tsx scripts/set-broker-utc-offset.ts <accountNo> <offsetMinutes>  # Required per account before ingestion runs
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

**Verification baseline:** No general end-to-end suite. `npm run build` + `npm run lint` standard checks. Run relevant `*.test.ts` files for logic changes. Bridge/Redis ingestion, history recovery, persistence, analytics changes require focused verification block below.

```bash
python3 -m pytest -q bridge_v2/tests
node --import tsx --test src/worker/*.test.ts src/lib/time.test.ts
npm run lint
npm run build:worker
npx tsc --noEmit
npm run build
```

For durable history recovery, also run opt-in integration test against isolated test DB/Redis stack when available.

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
- `docs/` — Reference material for in-progress feature design docs (e.g. `mql5book.pdf`, `analytic-principles.pdf`); `docs/architecture-data-models.md` living per-model reference for `prisma/schema.prisma` — check before Data Model section below for anything deeper than summary
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
- `EquitySnapshot` — Intraday equity/margin samples (60s cadence) backing 1D sparkline equity line
- `PositionExcursion` — Per-position P/L excursion samples captured alongside equity snapshots
- `BridgeHistoryCheckpoint` / `BridgeHistoryChunk` / `BridgeHistoryRecord` — Durable checkpoint state for automatic bounded history backfill across Deal, Order, closed-position stream contracts. Checkpoint advances only after all required stream barriers arrive, counts/digests match, complete chunk durably persisted, PostgreSQL checkpoint transaction commits. See `src/worker/history-checkpoint.ts`.

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

**Account ordering:** Default sort `Growth` `1D` descending. Tie-breakers: `Pips` `1D`, then balance desc, then accountNo asc.

**Zero-as-empty pattern:** `kpiValue(v)` converts `0 | null | undefined → null` so formatters output `"-"` instead `"0"`. Use at KPI chip layer; don't pass raw 0 to display formatters.

## History Backfill and Durability

- Missing history cursor plus no completed durable checkpoint means account requires automatic full-history backfill from `2000-01-01`; never fall back silently to `now - 30 days`.
- Backfill runs in bounded, configurable date chunks and resumes from last PostgreSQL-confirmed checkpoint after interruption.
- Publishing chunk to Redis not completion. Progress advances only after Node worker durably persisted complete chunk and PostgreSQL checkpoint transaction committed.
- Redis transport and coordination mirror, not authoritative source of backfill completion. Durable state must be reconstructable from PostgreSQL after Redis loss.
- Empty windows must be recorded as completed so historical coverage can be proven gap-free.
- Replay must be idempotent for Deals, Orders, closed Positions, barriers, acknowledgments.
- Live polling may continue while backfill runs, but backfill state machine must prevent gaps, premature cursor advancement, duplicate persistence.
- Once full backfill reaches present and marked complete, account switches to forward-only incremental history sync. Missing cursor after durable completion must be reconstructed safely from PostgreSQL or fail loudly; never reintroduce 30-day fallback.

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

## Agent Workflow Notes

- Check worktree before editing — repo may have unrelated local experiments.
- **Worker migration in progress:** `src/worker/` and `src/worker-v2/` both run live in `docker-compose.yml` (services `worker` and `worker-v2`, separate npm scripts) side by side during cutover. `src/worker-v3/` scaffolding only, no npm script yet. See `docs/worker-v3-implementation-plan.md` and `docs/superpowers/plans/2026-07-14-worker-v2-redis-to-postgres.md` for migration state; update this note (or delete it) once v3 lands and rename to `src/worker/` happens.
- Dashboard work starts `src/components/trading-monitor/`, `src/app/globals.css`, account API routes.
- Account API: `GET /api/accounts` (account list with snapshots); `GET /api/accounts/[id]?timeframe=...` (account detail with positions/deals); `GET /api/accounts/[id]/trade-history` (cursor-paginated trade history).
- Economic calendar API: `GET /api/economic-events?scope=expanded` returns 30-day window; default scope returns today + nearest week. Forex Factory source, Bangkok time, `force-dynamic`.
- Health check: `GET /api/health`.
- Update `AGENTS.md` for UI direction/layout changes; update `CLAUDE.md` for workflow, command, or stack changes.
- **Before every `git push`:** ask user confirm `package.json` `version` bump (`x.x` format, e.g. `7.0` → `7.1`) apply same commit being pushed.