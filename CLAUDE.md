# CLAUDE.md

Guidance for Claude Code (claude.ai/code) work in this repo.

## What This Is

`analytic` — Next.js trading account monitor, MT5-style account data. Operational dashboard, not marketing site — built help operators spot which accounts matter most, track balance/equity curves, drill into performance no lost context. Optimized mobile (portrait/landscape) iOS Safari.

Deeper reference material:

- `docs/ARCHITECTURE.md` — bridge architecture spec and invariants (broker-time opacity, UTC separation, SQLite authority, fencing)
- `docs/decisions/` — ADRs 0001–0006 (native bridge greenfield, worker-v2 adoption, Redis live transport, FTP import deprecation, bridge single-owner model, empty-region window coalescing)
- `docs/incidents/` — postmortem records
- `docs/architecture-data-models.md` — living per-model reference for `prisma/schema.prisma` (check before the Data Model summary below)
- `CHANGELOG.md` — release history
- `docs/superpowers/plans/` — implementation plans in flight, e.g. `2026-08-17-windows-single-host-migration.md` (active migration onto the single forexvps Windows host)

## Skills

(`.agents/skills/*` are committed symlinks to `.claude/skills/*` targets — they resolve on POSIX checkouts but materialize as dead text files on Windows, so prefer the `.claude/skills/` paths.)

**vps-ops** (`.claude/skills/vps-ops/`) — Windows-only operations runbook for the forexvps single host (iMessage status summaries via the hermes gateway, deploys, NSSM installs, MT5 EA `.chr` edits). This repo is the source of truth; hermes consumes a copy at `C:\Users\supachai\.agents\skills\vps-ops\` (see the skill's `INSTALL.md`). Host-guarded — applies only when actually running on that Windows host, never on macOS/dev checkouts.

**docs-sync** (`.claude/skills/docs-sync/`) — maps a diff to the docs it can invalidate (`AGENTS.md`, `CHANGELOG.md`, `docs/ARCHITECTURE.md`, …): `node .claude/skills/docs-sync/scripts/docs-impact.mjs [--diff A..B] [--check]`. Run before committing behavior changes; the repo copy is the source of truth (installed mirrors are synced outward from it, never edited in place).

**verify** (`.claude/skills/verify/`) — runtime-verification recipe for this host: spare-port dev server (3000 is production web), Node Playwright + system Chrome (`node` is not on PATH in helper subshells — use `C:\nvm4w\nodejs\node.exe`), dashboard flows and polling gotchas.

## Core Commands

```bash
npm run dev              # Next dev server
npm run build            # Required baseline verification for app changes (chains build:view-worker — sync-standalone fails hard if the worker bundle is missing)
npm run test             # Whole-repo unit suite (src/**/*.test.ts via node --test) — CI baseline
npm run start            # Run the production (standalone) build
npm run lint             # ESLint 9 flat config over src/ and scripts/

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
node --import tsx --test src/lib/trading/view-build-contract.test.ts
node --import tsx --test src/lib/trading/view-build-worker.e2e.test.ts
node --import tsx --test src/lib/trading/timeframe-view-dedupe.test.ts
node --import tsx --test src/lib/trading/preaggregated/panel-aggregates.test.ts
node --import tsx --test src/components/trading-monitor/useApiResource.test.ts
node --import tsx --test src/components/trading-monitor/card/AccountCardStrip.test.ts

# Worker V2 (history, live state, equity sampling, calendar)
npm run worker-v2
npm run worker-v2:dev

npm run db:clean                                                       # Local data cleanup
node --import tsx scripts/set-broker-utc-offset.ts <accountNo> <offsetMinutes>  # Required per account before ingestion runs
node --import tsx scripts/set-broker-utc-offset.ts --list                      # List accounts + current offsets
python -m bridge.scripts.replay_published_outbox --journal <journal.sqlite3> --login <login> --target-id <recovery-target> --confirm REPLAY_PUBLISHED_OUTBOX # Replays retained native PUBLISHED history to a verified clean Redis target; source SQLite remains read-only

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
- `src/lib/trading/view-precompute.ts` + `view-build-worker*.ts` — per-source-version invariant precompute + worker-thread build protocol (source session-cached per version; views structured-cloned back)
- `src/lib/trading/preaggregated/panel-aggregates.ts` — server-side bot-performance and daily-P/L panel aggregates (ride `positions.summary`)
- `src/lib/time.ts` — Bangkok-timezone utilities (Asia/Bangkok, UTC+7)
- `src/worker-v2/` — sole Node worker: durable Deal/Order/Position ingestion, account provisioning, live state, equity/excursion sampling, economic calendar, and component health
- `prisma/schema.prisma` + `prisma/migrations/`
- `scripts/` — Operational scripts (cleanup, backfill, remediation)
- `docs/` — Reference material (MQL5 property extracts, design docs); `docs/architecture-data-models.md` living per-model reference for `prisma/schema.prisma` — check before Data Model section below for anything deeper than summary
- `design-system/trading-monitor/MASTER.md` — Design tokens single source of truth

**Data Path:** `MT5 API` → `Python Bridge` → `Redis Streams` / Redis live state → `Worker` (consume/sample) → `PostgreSQL`.

**Single environment (forexvps — Windows Server 2022, single host, dev = prod):** native Windows services — `postgresql-x64-18` + `redis-wsl` (Redis 7.2 in WSL2) + `analytic-web` + `analytic-worker` + `caddy` (sole public exposure, `https://therng.duckdns.org`) alongside the MT5 terminals and the `bridge` NSSM service. Data plane is loopback-only. There is no separate local Docker dev stack — the retired `docker-compose.yml` dev topology and `src/worker/`/`src/worker-v3/` runtimes must not be reintroduced. Migration plan: `docs/superpowers/plans/2026-08-17-windows-single-host-migration.md`.

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
- `EconomicEvent` — Forex Factory calendar cache (currency, name, eventTime, impact, forecast/previous/actual); unique on `(currency, name, eventHourBucket)`
- `SocialUser` — social-feature identity (unique `oauthId`+provider, unique username)

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

**Account ordering:** Default sort `Trades` `1D` (today's closed-position count) descending. Tie-breakers: `Growth` `1D`, then `Pips` `1D`, then balance desc, then accountNo asc.

**Zero-as-empty pattern:** `kpiValue(v)` normalizes `null | undefined → null` so formatters output `"-"` for missing values; zero metrics are preserved (0 renders as a formatted zero). Apply at the KPI chip layer; where zero means empty, convert per-metric at the call site (e.g. `formatCompactCount(openCount || null)`).

## History Backfill and Durability

- Missing history cursor plus no completed durable checkpoint means account requires automatic retained-history backfill from `2025-01-01`; never fall back silently to `now - 30 days`.
- Backfill runs in bounded, configurable date chunks and resumes from the last durably committed checkpoint after interruption. Coverage proof rests on contiguous half-open `[start, end)` windows, not fixed one-day granularity: while the committed prior window is provably empty, windows widen to the 30-day coalescing span (`BRIDGE_HISTORY_EMPTY_WINDOW_RAW`, ADR-0006) and collapse back to one day once non-empty.
- Publishing chunk to Redis not completion. Progress advances only when the bridge's SQLite journal durably records the completed window and the Node worker has durably persisted the complete chunk (idempotent upserts). Backfill/coverage bookkeeping is owned by the bridge SQLite journal, not PostgreSQL checkpoints.
- Redis transport and coordination mirror, not authoritative source of backfill completion. Durable state must be reconstructable from PostgreSQL after Redis loss.
- Empty windows must be recorded as completed so historical coverage can be proven gap-free.
- Replay must be idempotent for Deals, Orders, closed Positions, barriers, acknowledgments.
- Live polling may continue while backfill runs, but backfill state machine must prevent gaps, premature cursor advancement, duplicate persistence.
- Once full backfill reaches present and marked complete, account switches to forward-only incremental history sync. Missing cursor after durable completion must be reconstructed safely from PostgreSQL or fail loudly; never reintroduce 30-day fallback.

## UI Stack

- **framer-motion** — Primary animation layer: expand/collapse panels, drag handles, entrance transitions. All variant objects live `src/lib/animations.ts` — always `...spread` into motion props; don't inline variant values.
- **ApexCharts / react-apexcharts** — Bot P/L distribution, trade-distribution and performance-radar charts; `dynamic` import required (SSR unsafe). Balance/equity sparkline and drawdown chart are hand-rolled SVG (`SparklineChart` in `MonitorShared.tsx`), not ApexCharts
- **Fonts:** Manrope (display/body), Noto Sans Thai + Mitr + Prompt (Thai), Bai Jamjuree (Thai alt/news), Azeret Mono (numeric mono), loaded via `@fontsource/*` in `globals.css`, wired through `src/lib/fonts.ts`
- **PWA:** Standalone mode applies `env(safe-area-inset-top)` for status bar; scroll content intentionally full-bleed
- **Design tokens:** Single source of truth `design-system/trading-monitor/MASTER.md` — surfaces, accent palette, semantic colors, typography, radius, motion timing. Don't copy token values inline; reference doc instead. Avoid Tailwind color defaults (`green-500`, `red-400`) — use semantic tokens.

## Dashboard Layout Model

Dashboard answers three questions fast: which accounts matter most, what balance/equity curve doing, where drill next no lost context.

- **Mobile landscape:** Two-zone account workspace; balance chart dominant.
- **Mobile portrait:** Single-column stack; compact header; dense KPI grid.
- **Real-time:** Live equity beacon (ring with heartbeat blink) indicates fresh polled Redis live state (2s HTTP poll; there is no WebSocket transport).

**Required KPI chips:** net gain, relative drawdown, pips, total trades, open positions.

## Environment Variables

Key ones (no root `.env.example` in-tree — `bridge/.env.example` documents every variable the bridge reads; ask the operator for reference local/test values — the old `.env.test.example` was removed with the Docker test stack in 8.46):

- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `WORKER_V2_HEALTH_PORT` — Component-aware health endpoint port (default: 9200)
- `WORKER_V2_ENABLE_LIVE_SYNC` — `AccountSnapshot`/`OpenPosition` writer toggle; defaults true, set false only for rollback
- `WORKER_V2_IDLE_RECLAIM_MS` — stale-consumer stream-entry reclaim threshold (default: 60000)
- `WORKER_V2_ACCOUNT_REFRESH_MS` — bridge account-registry refresh cadence (default: 60000)
- `WORKER_V2_EQUITY_SAMPLE_MS` / `WORKER_V2_EQUITY_RETENTION_DAYS` — equity cadence (60000 ms) and retained closed snapshot window (7 days)
- `WORKER_ECONOMIC_EVENTS_POLL_MS` — Forex Factory poll cadence (default: 3600000)
- `REDIS_PASSWORD` — Production Redis on forexvps is loopback-only behind `requirepass`.
- `DUCKDNS_TOKEN` — Required for the HTTPS `therng.duckdns.org` Caddy site; the HTTP site remains available without it

## Agent Workflow Notes

- Check worktree before editing — repo may have unrelated local experiments.
- **Worker V2 is the sole active Node worker:** it owns account provisioning, durable Deal/Order/Position ingestion, `AccountSnapshot`/`OpenPosition`, `EquitySnapshot`/`PositionExcursion`, and economic events. The retired `src/worker/` and `src/worker-v3/` runtimes must not be reintroduced. It consumes the native bridge (`bridge/`) contract directly: `mt5:account:{login}:live` and `mt5:account:{login}:stream:history` (see `src/worker-v2/history-consumer.ts`, `src/worker-v2/live-sync.ts`). Backfill/coverage bookkeeping is owned entirely by the bridge's own SQLite journal now, not the worker or PostgreSQL.
- Dashboard work starts `src/components/trading-monitor/`, `src/app/globals.css`, account API routes.
- Account API: `GET /api/accounts` (account list with snapshots); `GET /api/accounts/[id]?timeframe=...` (account overview: KPIs, balance curve, open positions — closed positions/deals come from the routes below); `GET /api/accounts/[id]/positions?timeframe=...&limit=...` (timeframe-scoped closed positions + panel summary — backs Bot P/L, pips detail, panel aggregates); `GET /api/accounts/[id]/trade-history` (cursor-paginated trade history).
- Economic calendar API: `GET /api/economic-events?scope=expanded` returns the full stored USD calendar window (DB read bounded to `eventTime >= now - 7 days`; upstream is the Forex Factory weekly feed); default scope returns today's events, else up to 4 upcoming, else the 4 most recent released. Forex Factory source, Bangkok time, `force-dynamic`.
- Health check: `GET /api/health` (liveness only — returns `{ok:true, timestamp}`; proves nothing about DB/Redis. The real pipeline probe is worker-v2 `:9200/health`, component-aware).
- **Production deploys**: `git pull` on `C:\analytic` + on-host rebuild (`npm ci` → `npx prisma generate` → `npm run build` → `npm run build:worker-v2` → `npx prisma migrate deploy` when migrations changed) + restart only the services the diff touched (`nssm restart`). Service control on this host is **nssm-only** — never `sc.exe` stop/start/config and never `sc config` for autostart (sc.exe is unusable from agent sessions). Sole exception: native `postgresql-x64-18` (not NSSM) → `Restart-Service`.
- Update `AGENTS.md` for UI direction/layout changes; update `CLAUDE.md` for workflow, command, or stack changes.
- **Before every `git push`:** ask user confirm `package.json` `version` bump (`x.x` format, e.g. `7.0` → `7.1`) apply same commit being pushed. No automated pre-push guard is installed — never commit hardcoded secrets (`REDIS_PASSWORD`/`DATABASE_URL`/`DUCKDNS_TOKEN`) or `.env*` files.
