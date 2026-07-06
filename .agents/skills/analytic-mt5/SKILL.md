---
name: analytic-mt5
version: 1.1.0
description: >
  Use this skill when working on the Analytic MT5 trading dashboard, MT5 Python Bridge,
  Redis live keys/streams, Prisma/PostgreSQL ingestion, worker runtime, dashboard KPI wiring,
  account snapshots, closed/open positions, deals/orders, drawdown/growth/pips/profit-factor metrics,
  and production debugging. This skill enforces the production source boundary:
  MT5 Bridge/Redis/PostgreSQL is the runtime path.
---

# MT5 Analytic Production Skill

## Prime Directive

The Analytic project runtime is **Bridge/Redis/PostgreSQL first**.

```
MT5 terminal/API
  → Python Bridge
  → Redis live hashes + Redis streams
  → worker consumers/samplers
  → PostgreSQL via Prisma
  → analytics/cache/API
  → dashboard UI
```

Do **not** reintroduce FTP import, legacy local-import paths, `worker:local`, file-hash deduplication, `ReportImport`, or dashboard mappings to fields unavailable from Bridge/Redis/PostgreSQL.

---

## When to Use This Skill

Use this skill for:

- Debugging MT5 account values missing or wrong on the dashboard.
- Tracing a field from MT5/Python Bridge → Redis → worker → Prisma → analytics/API → UI.
- Adding or changing a Bridge payload field.
- Fixing Redis stream consumers, live key sampling, account freshness, or duplicate bridge issues.
- Reviewing Prisma models for `Deal`, `Order`, `Position`, `OpenPosition`, `AccountSnapshot`, `EquitySnapshot`, `PositionExcursion`, or cached aggregate results.
- Computing growth, balance/equity drawdown, Sharpe/Sortino, profit factor, win rate, pips, deposits/withdrawals, or open exposure.
- Comparing legacy database data against Bridge runtime data before migration cutoff.

---

## Skill Hierarchy

1.  **`analytic-mt5` has highest priority for this repo.** It defines the production runtime boundary, source-of-truth rules, MT5 bridge flow, Redis key/stream contract, Prisma target models, worker behavior, analytics rules, and dashboard metric contract.
2.  **General Redis skills are supporting references only.** Use them for Redis data types, connection hardening, security, observability, TTLs, and key naming, but they must not override `analytic-mt5` runtime contracts.
3.  **General Prisma skills are supporting references only.** Use them for Prisma CLI, schema validation, generated client usage, Postgres modeling, migrations guidance, and type safety, but they must not override `analytic-mt5` model/source boundaries.
4.  **If there is a conflict:**
    *   Follow `analytic-mt5` first.
    *   Use Redis/Prisma skills only to implement the project-specific contract safely.
    *   Do not introduce generic architecture that conflicts with Bridge/Redis/PostgreSQL runtime.
    *   Do not reintroduce FTP, local import, ReportImport, or file-hash dedup paths.
5.  **Continue implementation under this hierarchy.** Start with discovery, then apply only safe code/type/doc/test fixes. Stop before destructive migrations, production credential changes, Redis key renames without backward compatibility, or irreversible database operations.

---

## Runtime Source Boundaries

Never mix runtime sources casually. Pick the authoritative source first.

| Data / Metric | Authoritative runtime source | Notes |
|---|---|---|
| Ledger, deposits, withdrawals, balance curve, balance drawdown, growth | `Deal` | From bridge deals stream. Balance/credit ops affect curve but are not trading P/L. |
| Closed trade metrics, win rate, profit factor, streaks, hold time, pips | `Position` | Closed positions only. |
| Open exposure, floating P/L, active count | `OpenPosition` plus fresh Redis positions | Current-state only. |
| Latest balance, equity, margin, margin level | `AccountSnapshot` plus fresh Redis live | Snapshot/current state. |
| Intraday equity, margin load, runtime equity drawdown, excursions | `EquitySnapshot`, `PositionExcursion` | Sampled from live bridge data. |
| Dashboard display contract | `src/lib/trading/metric-registry.ts` | Every UI metric needs source, formula, API field, formatter, target. |
| Cached aggregate summary | `AccountReportResult` | Cache only; not authoritative. Recompute after stream mutations. |

Critical invariant:

```
positionNetPnl = profit + swap + commission
```

Never use `profit` alone for net P/L.

---

## Production Redis Contract

### Live keys

| Key | Meaning | Freshness rule |
|---|---|---|
| `mt5:account:{login}:live` | account live hash: balance, equity, margin, margin level, floating P/L, timestamp | Can outlive bridge; do not trust alone for destructive updates. |
| `mt5:account:{login}:positions` | active positions JSON | Freshness guard for mutating `AccountSnapshot` and replacing `OpenPosition`. |
| `mt5:account:{login}:equity-state` | runtime peak/drawdown state | Used by equity sampler. |
| `bridge:heartbeat:{login}` or equivalent heartbeat key | bridge liveness | Use TTL/fresh timestamp for UI active/inactive state. |
| `bridge:lock:{login}` | duplicate bridge guard | Prevents two bridges for the same account login. |

### Streams

| Stream | Consumer | Target Prisma model |
|---|---|---|
| `mt5:account:{login}:deals-stream` | `src/worker/bridge-consumer.ts` | `Deal` |
| `mt5:account:{login}:orders-stream` | `src/worker/bridge-consumer.ts` | `Order` |
| `mt5:account:{login}:position-closed-stream` | `src/worker/bridge-consumer.ts` | `Position` |

Acknowledge stream entries only after Prisma upsert succeeds. Reclaim stale pending entries and retry. Recompute account report result once per drained batch, not after every row.

---

## Standard Debug Flow

### 1. UI value wrong or missing

1. Identify the dashboard component and API field.
2. Check `src/lib/trading/metric-registry.ts` for source, formula, formatter, and target.
3. Trace through `src/lib/trading/preaggregated-cache.ts` and `src/lib/trading/account-data.ts`.
4. Check API route serialization: `/api/accounts` or `/api/accounts/[id]?timeframe=...`.
5. Verify the authoritative DB table or Redis key.
6. Fix the earliest incorrect boundary, then add a focused test.

### 2. Worker not updating accounts

1. Confirm Redis keys exist for the account login.
2. Check worker logs for `[bridge-consumer]` and `[equity-sampler]` errors.
3. Check health endpoint if `WORKER_HEALTH_PORT > 0`.
4. Inspect Redis stream pending entries before assuming data is missing.
5. Confirm Prisma unique keys match bridge identifiers.
6. Run focused tests:

```bash
node --import tsx --test src/worker/bridge-only-runtime.test.ts
node --import tsx --test src/worker/equity-sampler.test.ts
node --import tsx --test src/worker/health.test.ts
npm run lint
```

### 3. Bridge account appears inactive but Redis is live

Treat an account as active if either:

- DB/account status is active, or
- fresh Bridge live/heartbeat data exists and is not stale.

Do not base the dashboard status dot only on `TradingAccount.updatedAt` if that timestamp is still tied to legacy/slow imports.

### 4. Duplicate account or terminal conflict

Production bridge launchers must guard by account login, not just terminal path.

Required behavior:

- one active bridge per account login;
- lock TTL refreshed while alive;
- duplicate terminal with same login must be skipped or suspended;
- bridge process must always launch MT5 terminal in portable mode when required;
- restart only dead/unhealthy child processes, not all accounts blindly.

---

## Add a New Bridge Field

1. Confirm the Python Bridge emits the field into the correct Redis payload.
2. Add it to the raw payload type and mapper:
   - `src/worker/bridge-mapper.ts` for stream payloads;
   - `src/lib/redis-mt5.ts` for live data.
3. Add or change Prisma schema via the project migration workflow.
4. Update recompute/analytics serialization under `src/lib/trading/`.
5. Update `src/lib/trading/metric-registry.ts` if displayed on the dashboard.
6. Update API response tests and focused worker tests.
7. Run lint and the smallest relevant tests first.

Do not add a UI field until the runtime source and formula are explicitly known.

---

## Metric Rules

### Growth

Use `Deal` balance curve and segment on balance/credit operations so deposits do not inflate trading performance.

```
segment_growth = endBalance / startBalance - 1
compounded_growth = (1 + g1) × (1 + g2) × ... × (1 + gN) - 1
```

### Balance drawdown

Use deal `balanceAfter` curve.

```
runningMax = max(balance seen so far)
drawdownPct = (runningMax - currentBalance) / runningMax × 100
```

### Equity drawdown

Use sampled/live equity curve, not closed-position balance curve.

### Profit factor

```
profitFactor = grossProfit / abs(grossLoss)
```

Return safe values when denominator is zero. Do not create `Infinity` in API/UI payloads unless the UI contract explicitly supports it.

### Sharpe

Use daily trading P/L series from deals and annualize with `sqrt(252)` unless the project-specific contract says otherwise.

### Pips

Use stored `Position.pips` when the bridge provides it. If computing locally, symbol scale must handle JPY pairs and metals separately.

---

## Common Mistakes to Prevent

| Mistake | Correct behavior |
|---|---|
| Reintroducing statement-file logic into runtime worker | Runtime uses Bridge/Redis/PostgreSQL only. |
| Using `position.profit` as net P/L | Always include swap and commission. |
| Computing drawdown from closed positions | Use deal balance curve for balance DD, equity snapshots for equity DD. |
| Treating all deals as trades | Balance/credit operations affect balance but are excluded from trading P/L. |
| Wiping open positions from stale live hash | Only replace `OpenPosition` when positions key is fresh. |
| Acknowledging Redis stream before DB write | Ack only after successful upsert. |
| Recomputing aggregate cache per stream row | Recompute once per drained batch. |
| Trusting `AccountReportResult` as source of truth | It is a cache; recompute or query authoritative tables. |
| UI metric without registry entry | Add source/formula/API/display contract first. |
| Duplicate bridge per same login | Use account-login lock/dedup guard. |

---

## Reference Files

Load these when the task needs details:

- `references/worker-internals.md` — Redis streams, live keys, worker services, sampler freshness, env vars.
- `references/analytics-runtime.md` — cache internals, timeframe logic, growth/drawdown algorithms, metric registry.
- `references/metrics-advanced.md` — HPR/AHPR/GHPR, Z-Score, LR correlation, MAE/MFE, money compounding, thresholds.
- `references/metrics-sharpe-sortino.md` — Sharpe/Sortino formulas and runtime return-series details.
- `references/overfitting-red-flags.md` — strategy over-optimization warning signs.

---

## Finish Criteria

Before saying a fix is done, report:

1. files changed;
2. source boundary used;
3. validation command run or the reason it could not be run;
4. risk or follow-up if any.

For production changes, prefer small focused tests first, then broader lint/test runs.
