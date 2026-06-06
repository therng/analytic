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

# Backend tests (Python pytest)
cd backend && source venv/bin/activate && PYTHONPATH=.. pytest

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


npm run test:formatters              # Unit tests: dashboard formatting logic
npm run test:parser                  # Unit tests: MT5 HTML report parser
npm run db:remediate-positions       # Dry-run fix for corrupted positions (add --apply to execute)
npm run db:clean                     # Local data cleanup
npm run db:backfill-report-results   # Recompute persisted AccountReportResult rows

# Full stack (local)
docker-compose up -d                 # Start all services: db, redis, web, gateway, worker, caddy

# Prisma
npx prisma migrate dev   # Apply migrations locally
npx prisma generate      # Regenerate client after schema edits
```

**Verification baseline:** No end-to-end suite. `npm run build` + `npm run lint` are the standard checks. Run the relevant `*.test.ts` or `pytest` files for logic changes. For parser, analytics, or import changes, also run the closest operational script against representative data.

## Architecture

**Stack:** Next.js 16 App Router + React 19, FastAPI (Python 3.12) Gateway, Redis 7 (broadcasting/cache), Prisma 6 + PostgreSQL 15, Node.js background worker, Caddy reverse proxy.

**Key directories:**
- `src/app/` — App Router pages, layouts, API routes (Historical data)
- `backend/` — FastAPI ingestion gateway and WebSocket manager (Real-time updates)
- `collector/` — Python sidecar for live MT5 terminal polling
- `shared/` — Shared Pydantic models for cross-service type safety
- `src/components/trading-monitor/` — Dashboard UI, formatters, account card logic, panels
- `src/lib/trading/` — Analytics engine, preaggregated cache views, report-result computation
- `src/lib/parser/` — MT5 HTML report parsing/normalization (cheerio)
- `src/lib/time.ts` — Bangkok-timezone utilities (Asia/Bangkok, UTC+7)
- `src/worker/` — Background FTP import worker (Node.js)
- `prisma/schema.prisma` + `prisma/migrations/`
- `scripts/` — Operational scripts (cleanup, backfill, remediation)

**Real-time Path:** `MT5 Node` → `Collector` (HTTPS POST + HMAC) → `Gateway` → `Redis Pub/Sub` → `WebSockets` → `Frontend`.
**Historical Path:** `MT5 FTP` → `Worker` (Parse) → `PostgreSQL` → `Next.js API` → `Frontend`.

**Docker Compose stack:** `db` (postgres:15-alpine) → `redis` (redis:7-alpine) → `web` (Next.js) → `gateway` (FastAPI) → `worker` (Node.js) → `caddy` (port 80).

## Data Model

Core tables (Prisma `@@map` exposes alternate SQL names — e.g. `TradingAccount` → `Account`):
- `TradingAccount` — Account metadata (accountNo, accountName, company, currency, serverName)
- `AccountSnapshot` — Current state (balance, equity, margin, marginLevel, floatingPl, creditFacility, freeMargin)
- `AccountReportResult` — Precomputed metrics cache (profitFactor, sharpeRatio, drawdowns, win stats, streaks)
- `Position` — Closed positions; unique on `(accountId, positionNo)`; includes `pips`
- `Deal` — All transactions; unique on `(accountId, dealNo)`; indexed on `time`
- `OpenPosition` — Active positions; unique on `(accountId, positionNo)` enables safe upsert
- `ReportImport` — Import tracking with SHA256 `fileHash` for dedup

**Source boundaries (critical — do not mix sources):**
- Win rate, profit factor, Sharpe, averaged metrics → `Position`
- Balance curve, growth, drawdown, intraday curves → `Deal`
- Floating P/L, open exposure, open counts → `OpenPosition` / `Redis`
- Latest balance, equity, margin, marginLevel → `AccountSnapshot` / `Redis`
- Trade P/L is always `positionNetPnl = profit + swap + commission` (include swap + commission)

**Precomputed `AccountReportResult` is a cache, not an authoritative source.**

## Key Conventions

**Code style:** 2-space indent, semicolons, double quotes, `@/` import aliases, `PascalCase` for components/types, `camelCase` for functions/hooks/variables. Python code uses `PEP8` (Ruff).

**Number formatting:**
- Full currency: 2 decimals, currency symbol with no space (`$1,234.57`, `-$1,234.57`)
- Compact monetary: no symbol, max 1 decimal, uppercase `K`/`M`/`B` suffixes, strip trailing `.0`
- Never mix compact and full currency in the same metric surface
- Backend keeps full precision; round only at the presentation layer

**Financial precision:** Use Prisma `Decimal` for monetary values in worker and DB layer. Convert to `number` only at the serialization boundary.

**Growth/analytics:** MQL5-style logic so deposits/withdrawals don't distort performance. Preserve balance-operation segmentation logic.

**Timezone:** All date/time uses Bangkok (Asia/Bangkok, UTC+7) via `src/lib/time.ts`.

**Account ordering:** Default sort is `Growth` `1D` descending. Tie-breakers: `Pips` `1D`, then balance desc, then accountNo asc.

## UI Stack

- **framer-motion** — Primary animation layer: expand/collapse panels, drag handles, entrance transitions
- **ApexCharts / react-apexcharts** — Balance/equity charts; `dynamic` import required (SSR unsafe)
- **Chart.js / react-chartjs-2** — Secondary charts
- **Fonts:** Sarabun + Noto Sans Thai (Thai body), Bai Jamjuree (numeric mono), loaded via `@fontsource/*`
- **PWA:** Standalone mode applies `env(safe-area-inset-top)` for status bar; scroll content is intentionally full-bleed
- **Gemini AI:** `@google/genai` available for text analysis (e.g. news sentiment); key via `GEMINI_API_KEY`. Do not feed AI-generated content into chart data paths.

## Dashboard Layout Model

The dashboard answers three questions fast: which accounts matter most, what the balance/equity curve is doing, and where to drill next without losing context.

- **Mobile landscape:** Two-zone account workspace; balance chart dominant.
- **Mobile portrait:** Single-column stack; compact header; dense KPI grid.
- **Real-time:** Live equity beacon (ring with heartbeat blink) indicates WebSocket activity.

**Required KPI chips:** net gain, relative drawdown, pips, total trades, open positions.

## Environment Variables

See `.env.example`. Key ones:
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `SECRET` — HMAC signing secret for Sidecar -> Gateway communication
- `FTP_HOST/PORT/USER/PASS/PATH` — FTP source for report imports
- `RUN_DB_MIGRATIONS` — Auto-migrate on web container startup

## Agent Workflow Notes

- Check the worktree before editing — this repo may have unrelated local experiments.
- Dashboard work starts in `src/components/trading-monitor/`, `src/app/globals.css`, and account API routes.
- Python backend work in `backend/` and `collector/`.
- Economic calendar API: `GET /api/economic-events?scope=expanded` returns 30-day window; default scope returns today + nearest week.
- Conductor feature tracks live in `.conductor/tracks/`; run `/conductor status` to see the active track and next actions.
- Update `AGENTS.md` for UI direction/layout changes; update `CLAUDE.md` for workflow, command, or stack changes.

