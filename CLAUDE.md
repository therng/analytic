# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`analytic` is a Next.js trading account monitor for MT5-style account data. It is an operational dashboard — not a marketing site — built to help operators quickly identify which accounts matter most, track balance/equity curves, and drill into performance without losing context. Optimized for mobile (portrait and landscape) on iOS Safari.

## Core Commands

```bash
npm run dev              # Next dev server
npm run build            # Required baseline verification for app changes
npm run start            # Run the production (standalone) build
npm run lint             # ESLint (Next.js defaults)

# Unit tests (Node built-in test runner via tsx)
npm run test:formatters  # Currency/compact formatters
npm run test:parser      # MT5 HTML report parser

# Run a single test file directly (no package script needed)
node --import tsx --test src/lib/time.test.ts
node --import tsx --test src/lib/trading/analytics.test.ts
node --import tsx --test src/lib/trading/account-data.test.ts
node --import tsx --test src/lib/trading/position-metrics.test.ts
node --import tsx --test src/components/trading-monitor/formatters.test.ts

# Worker (background FTP import + recompute)
npm run worker           # Build + run continuously
npm run worker:dev       # Run via ts-node (no build)
npm run worker:once      # Single pass
npm run worker:reimport  # Single pass, force reimport from configured (FTP) source
npm run worker:local  # Single pass, force reimport from local files (REPORT_SOURCE=local)

# Operational scripts
npm run db:backfill-report-results  # Recompute persisted AccountReportResult rows
npm run db:remediate-positions      # Dry-run fix for corrupted positions (add --apply to execute)
npm run db:clean                    # Local data cleanup

# Prisma
npx prisma migrate dev   # Apply migrations locally
npx prisma generate      # Regenerate client after schema edits
```

**Verification baseline:** No end-to-end suite. `npm run build` + `npm run lint` are the standard checks. Run the relevant `*.test.ts` files for logic changes. For parser, analytics, or import changes, also run the closest operational script against representative data.

## Architecture

**Stack:** Next.js 15 App Router + React 18, Prisma 6 + PostgreSQL 15, background worker (esbuild-bundled Node 20), Caddy reverse proxy.

**Key directories:**
- `src/app/` — App Router pages, layouts, API routes
- `src/components/trading-monitor/` — Dashboard UI, formatters, account card logic, panels
- `src/lib/trading/` — Analytics, preaggregated cache views, account helpers, types, report-result computation
- `src/lib/parser/` — MT5 HTML report parsing/normalization (cheerio)
- `src/lib/time.ts` — Bangkok-timezone utilities (Asia/Bangkok, UTC+7) — critical for chart boundaries and trade-time analytics
- `src/lib/prisma.ts` — Prisma client singleton
- `src/lib/analytics.ts` — Client analytics event tracking
- `src/worker/` — Background FTP import + recompute worker (single `index.ts`, bundled to `dist/worker.js`)
- `prisma/schema.prisma` + `prisma/migrations/`
- `scripts/` — Operational scripts (cleanup, backfill, remediation)

**API routes (`src/app/api/`):**
- `accounts/` — List all accounts
- `accounts/[id]/` — Overview (KPIs, balance curve, open positions); `route-helpers.ts` is shared by sibling routes
- `accounts/[id]/balance-detail/` — Balance + drawdown details
- `accounts/[id]/profit-detail/` — Profit analytics (commissions, swaps, deposits/withdrawals)
- `accounts/[id]/win-detail/` — Win rate, short/long, largest profit, consecutive wins
- `accounts/[id]/positions/` — Open + historical positions
- `accounts/[id]/pips-summary/` — Pips performance by symbol
- `economic-events/`, `xauusd-candles/` — Market context endpoints
- `health/` — Health check

All `accounts/[id]/*` endpoints accept `?timeframe=1d|1w|1m|ytd|1y|all`. Heavy reads go through the preaggregated cache layer in `src/lib/trading/preaggregated-cache.ts`.

**Docker Compose stack:** `db` (postgres:15-alpine) → `web` (Next.js, runs migrations when `RUN_DB_MIGRATIONS=true`) → `worker` (runs `dist/worker.js`) → `caddy` (port 80, proxies to web).

## Data Model

Core tables (Prisma `@@map` exposes alternate SQL names — e.g. `TradingAccount` → `Account`):
- `TradingAccount` — Account metadata (accountNo, accountName, company, currency, serverName, reportDate)
- `AccountSnapshot` — Current state (balance, equity, margin, marginLevel, floatingPl, creditFacility, freeMargin)
- `AccountReportResult` — Precomputed metrics cache (profitFactor, sharpeRatio, drawdowns, win stats, streaks, gross profit/loss)
- `Position` — Closed positions; unique on `(accountId, positionNo)`; includes `pips` for O(1) lookup; indexed on `(accountId, openTime|closeTime|reportDate)`
- `Deal` — All transactions; unique on `(accountId, dealNo)`; indexed on `(accountId, time|type|reportDate)` and `symbol`
- `OpenPosition` — Active positions; unique on `(accountId, positionNo)` enables safe upsert (replaces older delete-all + re-insert pattern)
- `ReportImport` — Import tracking with SHA256 `fileHash` for dedup (unique on `(accountId, fileHash)`)

**Source boundaries (critical — do not mix sources):**
- Win rate, profit factor, Sharpe, expected payoff, average/largest win-loss trade, consecutive streaks, trades-per-week, avg hold time → `Position`
- Balance curve, growth, drawdown, intraday D-timeframe → `Deal`
- Floating P/L, open exposure, open counts → `OpenPosition`
- Latest balance, equity, margin, marginLevel → `TradingAccount` / `AccountSnapshot`
- Trade P/L is always `positionNetPnl = profit + swap + commission` (include swap + commission)

**Precomputed `AccountReportResult` is a cache, not an authoritative source** — source-derived computation must remain correct on its own.

## Key Conventions

**Code style:** 2-space indent, semicolons, double quotes, `@/` import aliases, `PascalCase` for components/types, `camelCase` for functions/hooks/variables. App and script code is TypeScript.

**Number formatting:**
- Full currency: 2 decimals, currency symbol with no space (`$1,234.57`, `-$1,234.57`)
- Compact monetary: no symbol, max 1 decimal, uppercase `K`/`M`/`B` suffixes, strip trailing `.0`
- Never mix compact and full currency in the same metric surface
- Provide access to full-precision value via tooltip/tap when compact is shown
- Backend keeps full precision; round only at the presentation layer

**Financial precision:** Use Prisma `Decimal` for monetary values in worker and DB layer. Convert to `number` only at the serialization boundary before sending to the client.

**Growth/analytics:** MQL5-style logic so deposits/withdrawals don't distort performance. Preserve balance-operation segmentation logic across UI and backend changes.

**Timezone:** All date/time uses Bangkok (Asia/Bangkok, UTC+7) via `src/lib/time.ts`. Critical for chart boundaries and trade-time analytics.

**Account ordering:** Default sort is `Growth` `1D` descending. Tie-breakers: `Pips` `1D`, then balance desc, then accountNo asc. Same ordering must be preserved across breakpoints, orientation changes, and selection.

## Dashboard Layout Model

The dashboard answers three questions fast: which accounts matter most, what the balance/equity curve is doing, and where to drill next without losing context.

- **Mobile landscape:** Two-zone account workspace; balance chart dominant; identity/growth/balance in card header; KPI chips visible without drill-down; horizontal paging between accounts acceptable if order remains stable.
- **Mobile portrait:** Single-column stack; compact header; chart above secondary content; timeframe controls attached to chart; KPI chips immediately after chart as a dense grid.
- **Shared:** Pull-to-refresh works from top of dashboard only (72px threshold, 116px max). Primary chart + KPIs fit without sideways panning. Horizontal scroll OK for secondary tables.

Avoid generic card-mosaic layouts, decorative gradients, marketing-style copy, or legacy `vh`/manual iOS height shims (uses `dvh` + `viewport-fit=cover`; PWA standalone mode applies top safe-area insets only).

**Required KPI chips:** net gain, relative drawdown, pips, total trades, open positions. Sub-metrics like floating P/L, margin level (when available), and win rate are surfaced in the expandable detail panels. The `TRADES` chip count and history list both use timeframe-filtered closed positions from `Position` only.

**Balance chart:** Single continuous line per selected account/timeframe. `D` timeframe is an intraday sparkline anchored to report date, prior-day close as baseline, fixed 0–23 hourly axis in report-local time, no permanent gridlines in the compact card, hover/tap reveals point balance + timestamp. Segment color marks balance-operation events (deposit/withdrawal). Live snapshot may append a live point when newer than the last historical point.

## Key Components

- `DashboardClient.tsx` — Main client; owns account list, selected account, timeframe, pull-to-refresh, analytics
- `shared.tsx` — Shared UI: `SparklineChart`, `TimeframeStrip`, `InlineState` skeletons, `TradingMonitorSharedStyles`
- `LoadingScreen.tsx` — Startup splash (Pure Black Terminal aesthetic)
- `SummaryChip.tsx`, `OpenPositionsPanel.tsx`, `TradeHistoryPanel.tsx`, `PipsPerformanceTable.tsx`, `ProfitHeatmapPanel.tsx`, `PerformanceQualityPanel.tsx`, `BotPnLPanel.tsx` — Dashboard panels
- `formatters.ts` / `DashboardFormatters.ts` — Number/date formatting helpers (each with companion `.test.ts`)
- `useApiResource.ts` — API fetch hook with loading/error states

## Environment Variables

See `.env.example`. Key ones:
- `DATABASE_URL` — PostgreSQL connection string
- `FTP_HOST/PORT/USER/PASS/PATH` — FTP source for report imports
- `WORKER_POLL_MS`, `WORKER_FILE_STABLE_MS`, `WORKER_MIN_FILE_SIZE_BYTES` — Worker tuning
- `WORKER_RUN_ONCE`, `WORKER_FORCE_REIMPORT`, `REPORT_SOURCE` — Worker mode flags (set by `worker:once|reimport|reimport:local` scripts)
- `NEXT_PUBLIC_MAINTENANCE_MODE` — Enables maintenance mode banner
- `RUN_DB_MIGRATIONS` — Auto-migrate on web container startup

## Agent Workflow Notes

- Check the worktree before editing — this repo may have unrelated local experiments.
- Dashboard work starts in `src/components/trading-monitor/`, `src/app/globals.css`, and account API routes.
- Keep API and UI terminology aligned (`/api/accounts` for list, `/api/accounts/[id]?timeframe=...` for overview).
- When changing parser/backfill behavior, note input expectations, migration risk, and rollback considerations in the PR.
- Update `AGENTS.md` when dashboard composition, responsive rules, account ordering, KPI definitions, API contracts, or verification expectations materially change.
