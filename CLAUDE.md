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
node --import tsx --test src/lib/trading/analytics.test.ts
node --import tsx --test src/lib/trading/account-data.test.ts
node --import tsx --test src/lib/trading/core/growth.test.ts
node --import tsx --test src/lib/trading/core/downsample.test.ts
node --import tsx --test src/lib/parser/index.test.ts

# Worker (background FTP import + recompute)
npm run worker           # Build + run continuously
npm run worker:dev       # Run via ts-node (no build)
npm run worker:local     # Single pass, force reimport from local files (REPORT_SOURCE=local)

npm run db:clean                     # Local data cleanup

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
- `docs/` — Design tokens reference (`Analytic Design Tokens (Standalone).html`) and UI patterns

**Real-time Path:** `MT5 Node` → `Collector` (HTTPS POST + HMAC) → `Gateway` → `Redis Pub/Sub` → `WebSockets` → `Frontend`.
**Historical Path:** `MT5 FTP` → `Worker` (Parse) → `PostgreSQL` → `Next.js API` → `Frontend`.

**Gateway API (FastAPI, default port 8000):**
- `POST /api/v1/ingest/update` — snapshot push from collector (requires HMAC headers: `X-Signature`, `X-Timestamp`, `X-Nonce`)
- `POST /api/v1/ingest/deals` — deal sync from collector
- `WS /ws/account/{account_id}` — WebSocket stream subscribed to by the frontend
- `GET /api/health` — gateway health check

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

**Zero-as-empty pattern:** `kpiValue(v)` converts `0 | null | undefined → null` so formatters output `"-"` instead of `"0"`. Use this at the KPI chip layer; do not pass raw 0 to display formatters.

## UI Stack

- **framer-motion** — Primary animation layer: expand/collapse panels, drag handles, entrance transitions. All variant objects live in `src/lib/animations.ts` — always `...spread` into motion props; do not inline variant values.
- **ApexCharts / react-apexcharts** — Balance/equity charts; `dynamic` import required (SSR unsafe)
- **Chart.js / react-chartjs-2** — Secondary charts
- **Fonts:** Sarabun + Noto Sans Thai (Thai body), Bai Jamjuree (numeric mono), loaded via `@fontsource/*`
- **PWA:** Standalone mode applies `env(safe-area-inset-top)` for status bar; scroll content is intentionally full-bleed
- **Gemini AI:** `@google/genai` available for text analysis (e.g. news sentiment); key via `GEMINI_API_KEY`. Do not feed AI-generated content into chart data paths.
- **Design tokens:** Single source of truth in `docs/Analytic Design Tokens (Standalone).html` — open in browser for surfaces, accent palette, semantic colors, typography, radius, and motion timing. Do not copy token values inline; reference the document instead. Avoid Tailwind color defaults (`green-500`, `red-400`) — use semantic tokens.

## Dashboard Layout Model

The dashboard answers three questions fast: which accounts matter most, what the balance/equity curve is doing, and where to drill next without losing context.

- **Mobile landscape:** Two-zone account workspace; balance chart dominant.
- **Mobile portrait:** Single-column stack; compact header; dense KPI grid.
- **Real-time:** Live equity beacon (ring with heartbeat blink) indicates WebSocket activity.

**Required KPI chips:** net gain, relative drawdown, pips, total trades, open positions.

## Environment Variables

Key ones (copy from `.env.example` in git history if needed):
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `SECRET` — HMAC signing secret for Sidecar -> Gateway communication
- `FTP_HOST/PORT/USER/PASS/PATH` — FTP source for report imports
- `RUN_DB_MIGRATIONS` — Auto-migrate on web container startup
- `LOCAL_REPORT_DIR` — Override local report source dir for `worker:local` (default: `data/source-reports`)
- `WORKER_POLL_MS` — Poll interval in ms (default: 150000)
- `WORKER_FILE_STABLE_MS` — File stability wait before ingestion (default: 60000)
- `WORKER_MIN_FILE_SIZE_BYTES` — Minimum file size to process (default: 1024)
- `WORKER_HEALTH_PORT` — Port for the worker heartbeat HTTP endpoint (`GET /health`); set to `0` to disable (default: 9100)
- `WORKER_HEALTH_STALE_MS` — Time since last poll activity before `/health` returns 503 (default: `WORKER_POLL_MS * 2 + 60000`)

**Collector-only (`collector/.env`):**
- `GATEWAY_URL` — FastAPI ingest URL (default: `http://localhost:8000/api/v1/ingest`)
- `API_SECRET` — HMAC shared secret matching backend `SECRET`
- `POLL_INTERVAL` — MT5 polling interval in seconds (default: 1)

## Agent Workflow Notes

- Check the worktree before editing — this repo may have unrelated local experiments.
- Dashboard work starts in `src/components/trading-monitor/`, `src/app/globals.css`, and account API routes.
- Python backend work in `backend/` and `collector/`.
- Account API: `GET /api/accounts` (account list with snapshots); `GET /api/accounts/[id]?timeframe=...` (account detail with positions/deals).
- Economic calendar API: `GET /api/economic-events?scope=expanded` returns 30-day window; default scope returns today + nearest week. Forex Factory source, Bangkok time, `force-dynamic`.
- Health check: `GET /api/health`.
- Update `AGENTS.md` for UI direction/layout changes; update `CLAUDE.md` for workflow, command, or stack changes.

