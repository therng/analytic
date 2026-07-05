---
name: mt5-import-pipeline
description: >
  Use when the user asks to run or debug the Analytic MT5 worker, inspect
  Bridge/Redis ingestion, add a Bridge field, fix a Prisma upsert, update the
  analytics layer, trace a value from Redis/PostgreSQL to a dashboard KPI,
  explain balance/equity/drawdown/pips/trades issues, or change metric wiring.
---

# MT5 Import Pipeline

## Pipeline Overview

```
MT5 API → Python Bridge → Redis Streams / Redis live keys
  └→ src/worker/bridge-consumer.ts + src/worker/equity-sampler.ts
       └→ PostgreSQL via Prisma
            └→ src/lib/trading/preaggregated-cache.ts
                 └→ Next.js API routes → Dashboard UI
```

The Analytic project is Bridge/Redis-only. Do not reintroduce FTP import, local HTML report parsing, `worker:local`, file-hash deduplication, `ReportImport`, or UI mappings to fields unavailable from the Bridge/Redis/PostgreSQL path.

`mt5-report-parser` is a standalone reference for historical MT5 HTML exports. Do not use it as an Analytic runtime dependency unless the user explicitly asks for an offline parser outside the Bridge/Redis dashboard path.

---

## Redis Inputs

### Stream Events

`src/worker/bridge-consumer.ts` drains per-account Redis streams:

| Stream | Mapper | Prisma table | Purpose |
|---|---|---|---|
| `mt5:account:{login}:deals-stream` | `mapDealPayloadToDeal` | `Deal` | Ledger, funding ops, balance curve, growth/drawdown |
| `mt5:account:{login}:orders-stream` | `mapOrderPayloadToOrder` | `Order` | Order history |
| `mt5:account:{login}:position-closed-stream` | `mapPositionClosedPayloadToPosition` | `Position` | Closed-position metrics and trade history |

The consumer creates Redis consumer group `worker`, reads entries, upserts by model unique keys, acknowledges only after a successful upsert, reclaims stale pending entries, then calls `recomputeAccountReportResult(accountId, latestReportDate)` once per drained batch.

### Live State

`src/worker/equity-sampler.ts` reads:

- `mt5:account:{login}:live` hash for balance, equity, margin, free margin, margin level, floating P/L, credit, currency, timestamp.
- `mt5:account:{login}:positions` JSON for active positions. This key has a short TTL and is the freshness guard for mutating `AccountSnapshot` and `OpenPosition`.
- `mt5:account:{login}:equity-state` hash for peak-equity-derived runtime drawdown.

The sampler writes `EquitySnapshot`, `PositionExcursion`, `AccountSnapshot`, and `OpenPosition`. It must not wipe open positions from stale live hashes after the positions key expires.

---

## Data Model — Critical Source Boundaries

**Never mix these sources:**

| What | Source | Notes |
|---|---|---|
| Balance curve, growth, deposits, withdrawals, drawdowns, intraday balance | `Deal` | Full ledger from bridge deal stream |
| Win rate, profit factor, expected payoff, streaks, trade sizes, hold time, pips | `Position` | Closed positions only |
| Floating P/L, open exposure, open count | `OpenPosition` / Redis live | Snapshot current-state only |
| Latest balance, equity, margin, marginLevel | `AccountSnapshot` / Redis live | Snapshot current-state only |
| Intraday equity, margin load, runtime excursions | `EquitySnapshot` / `PositionExcursion` | 1D equity line, LOAD, excursion analysis |
| Metric metadata and display contract | `src/lib/trading/metric-registry.ts` | Every dashboard metric needs source, formula, API field, display target |
| Cached aggregate fields | `AccountReportResult` | Cache only; not authoritative |

**positionNetPnl** = `profit + swap + commission` (always include all three; never use `profit` alone).

**Funding ops** are deal rows such as balance/credit operations. They affect the balance curve and growth segmentation, but are excluded from trading P/L.

---

## Worker (`src/worker/index.ts`)

`npm run worker` builds and runs `dist/worker.js`. `npm run worker:dev` runs `src/worker/index.ts` via `tsx`.

Runtime services:
- `startBridgeConsumer()` continuously drains Redis streams for all bridge accounts.
- `startEquitySampler()` samples Redis live state into snapshot/runtime tables.
- `startHealthServer()` exposes worker health at `GET /health` when `WORKER_HEALTH_PORT > 0`.

> Stream processing, live-state freshness, and environment variables → `references/worker-internals.md`.

---

## Analytics (`src/lib/trading/preaggregated-cache.ts`)

Main API-facing entry: `getCachedAccountView(accountId, timeframe, kind)` returns prebuilt dashboard views from an in-memory account bundle cache. Timeframe changes select a different cached view.

Dashboard/API timeframe keys are `D`, `1W`, `1M`, `3M`, `6M`, `1Y`, and `ALL`. The public API accepts `/api/accounts/[id]?timeframe=...`; the implementation normalizes aliases internally.

Key computed metrics:
- **Growth**: `computeCompoundedGrowth` — MQL5-style, segments on balance ops so deposits don't inflate performance
- **Drawdown**: `computeBalanceDrawdown` — max peak-to-trough from the Deal balance curve
- **Sharpe**: `computeAnnualizedSharpeRatio` — annualized from daily deal P/L
- **Pips**: stored on `Position.pips` from bridge-closed positions
- **Open exposure**: `OpenPosition` plus Redis-backed `AccountSnapshot`
- **1D equity line**: `EquitySnapshot` plus a fresh live Redis point when available

`recomputeAccountReportResult(accountId, sourceReportDate)` in `src/lib/trading/calculate-report-results.ts` writes `AccountReportResult` from authoritative `Position` + `Deal` tables after stream batches.

> Detailed analytics internals, timeframe logic, and growth/drawdown algorithms → `references/analytics.md`.

---

## Common Workflows

### Debug: worker is not updating accounts

1. Confirm Redis keys exist: `mt5:account:{login}:live`, `:positions`, `:deals-stream`, `:orders-stream`, `:position-closed-stream`.
2. Check worker logs for `[bridge-consumer]` or `[equity-sampler]` errors.
3. Check `GET /health` when `WORKER_HEALTH_PORT` is enabled.
4. Run focused tests: `node --import tsx --test src/worker/bridge-only-runtime.test.ts`, `src/worker/equity-sampler.test.ts`, and `src/worker/health.test.ts`.

### Add a new Bridge field

1. Confirm the field exists in the Python Bridge Redis payload.
2. Add it to the relevant raw payload type and mapper in `src/worker/bridge-mapper.ts` or live-data type in `src/lib/redis-mt5.ts`.
3. Add or change Prisma columns with the `create-migration` skill.
4. Update analytics/API serialization in `src/lib/trading/` and API routes.
5. Update `src/lib/trading/metric-registry.ts` if the dashboard displays the metric.
6. Add focused worker/trading tests, then run `npm run lint`.

### Trace a dashboard value

1. Start at `src/lib/trading/metric-registry.ts` for source, formula, API field, and display target.
2. Follow serialization through `src/lib/trading/preaggregated-cache.ts` and `src/lib/trading/account-data.ts`.
3. Check API routes: `/api/accounts` for list, `/api/accounts/[id]?timeframe=...` for detail.
4. Inspect the target UI under `src/components/trading-monitor/`.

---

## Reference Files

- `references/worker-internals.md` — Redis stream/live keys, bridge consumer behavior, sampler freshness, worker env vars
- `references/analytics.md` — preaggregated cache internals, source boundaries, timeframe logic, growth/drawdown algorithms

**Cross-skill references:**
- `create-migration` — required for Prisma schema edits and migrations
- `docker-debug` — use when the local docker-compose stack, worker, Redis, or gateway is down
