# MT5 Bridge → Redis → Postgres migration (retire FTP report pipeline)

> **SUPERSEDED:** Do not use this as the active implementation design. The current merged design is `docs/superpowers/specs/2026-07-04-bridge-only-metric-remap-design.md`, which removes FTP/manual import paths instead of adding side-by-side FTP validation, parser comparison scripts, or Bridge* shadow-table validation.

**Status:** Draft — pending approval
**Date:** 2026-07-02
**Author:** Claude Code (session), reviewed with therng

## Problem

Today `analytic` has two independent data paths out of MT5:

```
MT5
 ├── Python Bridge (Live, 2s poll)  →  Redis  →  live dashboard views (real-time)
 └── FTP HTML Reports (periodic)    →  Node cheerio parser  →  Postgres (Position, Deal,
                                                                  OpenPosition, AccountSnapshot)
```

The FTP/HTML path is the only source for closed-trade history (`Position`, `Deal`) and
report-cadence snapshots (`AccountSnapshot`, `OpenPosition`). It has two structural
limitations that block the "Advanced MT5 Metrics" analytics roadmap
(MAE/MFE, equity drawdown, profit↔MAE/MFE correlation, and future metrics):

1. **No MAE/MFE data.** MT5 HTML reports contain only entry/exit price and realized
   profit — never the intraperiod excursion (worst/best unrealized P/L reached while a
   position was open). This data only exists transiently in the live terminal.
2. **Report cadence, not event cadence.** History appears only when a report is
   generated/uploaded, with import latency and no guaranteed granularity.

The Python bridge (`bridge/mt5_bridge.py`) already holds a live `MetaTrader5` API
session per account (2s poll) and confirmed access to `history_deals_get()` /
`history_orders_get()` / `positions_get()` / `orders_get()`. It is the only component
with access to true intraperiod excursion data, so it must become the source that
captures it — this can't be added after the fact from historical exports.

## Goal

Make the Python bridge the single source of truth for all MT5 trading data. Retire the
FTP/HTML report pipeline once a parallel-validation period confirms the new path
produces matching data. Capture enough **raw** data (not just derived metrics) that
future analytics (HPR/AHPR/GHPR, Sharpe, Sortino, Z-Score, LR correlation, MAE/MFE
correlation, and metrics not yet designed) can be computed or recomputed without
further bridge changes.

Existing metric formulas in `src/lib/trading/analytics.ts` are unaffected by this
migration — they already derive purely from `Position`/`Deal`/equity-timeline shaped
data. This migration changes _where that data comes from_, plus adds the handful of
genuinely new raw fields (MAE/MFE, peak equity, orders) that only the live bridge can
observe.

## Non-goals

- Changing any analytics formula in `analytics.ts`.
- Changing the dashboard UI/API surface (`/api/accounts/*`) — those continue reading
  from the same tables/Redis keys they do today; this migration only changes how those
  tables/keys get populated.
- Multi-region/multi-VPS bridge scaling beyond the current ~10-account, single-VPS
  supervisor model (`run_all.py`) — out of scope, current model already supports
  adding more accounts linearly.

## Architecture

### 1. Bridge process (per account; one process per terminal, per existing model)

Each `mt5_bridge.py` process runs three concurrent responsibilities instead of one:

| Responsibility                                 | Interval | Behavior                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Live poll** (existing, extended)             | 2s       | `account_info()` + `positions_get()`, as today. Additionally updates in-memory running MAE/MFE per open ticket and running peak-equity/drawdown. Persists this tracking state to Redis every poll (see below) so a bridge restart does not reset mid-life tracking.                                                                           |
| **History sync** (new)                         | 30s      | `history_deals_get()` / `history_orders_get()` for everything after a per-account cursor. Publishes each new deal/order as a raw event to its Redis stream. Advances the cursor only after a successful publish.                                                                                                                              |
| **Close detection** (new, part of the 2s loop) | 2s       | Diffs the current `positions_get()` ticket set against the previous poll's set. Any ticket that disappeared is considered closed: the bridge looks up the matching deal(s) from the history cache/cursor, combines them with its own accumulated MAE/MFE/peak state for that ticket, and publishes a single enriched "position-closed" event. |

**Running excursion tracking (per open ticket, in-memory + Redis-persisted):**

- `mae` — lowest `profit` observed since the ticket first appeared open (≤ 0).
- `mfe` — highest `profit` observed since the ticket first appeared open (≥ 0).
- `firstSeenTs`, `entryPrice` (from first-seen `price_open`).

**Running equity tracking (per account, in-memory + Redis-persisted):**

- `peakEquity` — running high-water-mark of `equity` since tracking began (this feature
  going live — no synthetic backfill).
- `peakEquityTs`, `trackingStartTs`.
- `drawdown = peakEquity - equity` (derived at read time, not stored in the state hash).

Both tracking states are re-seeded from Redis on bridge startup (for tickets that are
still open per `positions_get()`), so a bridge crash/restart does not silently reset
excursion or drawdown tracking for a long-held position — only the (typically
sub-second) restart gap is lost.

### 2. Redis schema

| Key                                          | Type                  | Purpose                                                                                                                                 |
| -------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `mt5:account:{login}:deals-stream`           | Stream                | Raw deal records from history sync. Source of truth for the `Deal`/`BridgeDeal` table.                                                  |
| `mt5:account:{login}:orders-stream`          | Stream                | Raw order records from history sync. Source of truth for the `Order`/`BridgeOrder` table.                                               |
| `mt5:account:{login}:position-closed-stream` | Stream                | One enriched event per closed position: deal(s), order(s), position summary, final `mae`/`mfe`, entry/exit price+time, duration.        |
| `mt5:bridge:history-cursor:{login}`          | String                | Last-synced deal time (unix ts). Read on startup so restarts resume from the last successful sync, not a full rescan.                   |
| `mt5:account:{login}:position-state`         | Hash (ticket → JSON)  | Running `mae`/`mfe`/`firstSeenTs`/`entryPrice` per open ticket. Updated every 2s poll; read on startup to reseed the in-memory tracker. |
| `mt5:account:{login}:equity-state`           | Hash                  | `peakEquity`, `peakEquityTs`, `trackingStartTs`. Updated every 2s poll; read on startup.                                                |
| `mt5:account:{login}:live`, `:positions`     | (existing, unchanged) | Current account snapshot / open positions, as today.                                                                                    |

**Delivery & retention:**

- All three streams use Redis consumer groups (`XREADGROUP`, group name `worker`) so
  the Node consumer can crash/restart without losing unacknowledged entries (`XCLAIM`
  reclaims stale pending entries on a periodic pass).
- After a stream entry's corresponding Postgres upsert is confirmed, the consumer
  `XACK`s it. Streams are periodically trimmed (`XTRIM ~ MAXLEN 10000` per stream) —
  Postgres is the durable system of record; Redis streams are transport only, not
  long-term storage.

### 3. Postgres schema

**New nullable columns on existing tables** (FTP path leaves these `null`; no
behavior change for existing FTP-sourced rows):

```prisma
model Position {
  // ...existing fields...
  mae Decimal? @db.Decimal(28, 8)  // final Maximum Adverse Excursion
  mfe Decimal? @db.Decimal(28, 8)  // final Maximum Favorable Excursion
}

model Deal {
  // ...existing fields...
  positionId String? @map("position_id")  // MT5 position_id — links Deal → Position → Order
  orderId    String? @map("order_id")     // MT5 order ticket
}

model EquitySnapshot {
  // ...existing fields...
  floatingPl Decimal? @map("floating_pl") @db.Decimal(28, 8)  // equity - balance, stored directly
  peakEquity Decimal? @map("peak_equity") @db.Decimal(28, 8)  // bridge's continuous high-water-mark
  drawdown   Decimal? @db.Decimal(28, 8)                       // peakEquity - equity
}

model PositionExcursion {
  // ...existing fields...
  runningMae Decimal? @map("running_mae") @db.Decimal(28, 8)  // bridge's continuous watermark as of ts
  runningMfe Decimal? @map("running_mfe") @db.Decimal(28, 8)
}
```

`peakEquity`/`runningMae`/`runningMfe` matter specifically because they are **not**
reconstructable later from sparse point-in-time samples — a 60s snapshot can miss a
spike that occurred between samples. Capturing the bridge's continuously-tracked
watermark at each 60s persistence point preserves that information permanently.

**New table** (raw order lifecycle capture; not consumed by any current analytics
formula, captured for future-proofing per requirements):

```prisma
model Order {
  id               String   @id @default(cuid())
  tradingAccountId String   @map("account_id")
  orderTicket      String   @map("order_ticket")
  positionId       String?  @map("position_id")
  dealId           String?  @map("deal_id")
  symbol           String?
  type             String?
  state            String?
  volume           Float?
  priceOpen        Decimal? @map("price_open") @db.Decimal(28, 8)
  priceCurrent     Decimal? @map("price_current") @db.Decimal(28, 8)
  sl               Decimal? @db.Decimal(28, 8)
  tp               Decimal? @db.Decimal(28, 8)
  timeSetup        DateTime? @map("time_setup")
  timeDone         DateTime? @map("time_done")
  comment          String?
  tradingAccount   TradingAccount @relation(fields: [tradingAccountId], references: [id], onDelete: Cascade)

  @@unique([tradingAccountId, orderTicket])
  @@map("Order")
}
```

**Shadow tables for validation** (dropped once FTP is retired and cutover is
confirmed stable):

```prisma
model BridgePosition { /* same shape as Position, incl. mae/mfe */ }
model BridgeDeal     { /* same shape as Deal, incl. positionId/orderId */ }
model BridgeOrder    { /* same shape as Order */ }
```

Bridge-sourced consumer writes here during validation instead of the real
`Position`/`Deal`/`Order` tables, so both sources coexist without one silently
overwriting the other. A comparison script diffs `BridgePosition`/`BridgeDeal` against
`Position`/`Deal` (joined on `positionNo`/`dealNo`).

**`AccountSnapshot` / `OpenPosition`:** no schema changes — existing columns already
match the Redis live-data shape. These are current-state caches, not append-only
history, so no shadow-table validation is needed; see rollout step below.

### 4. Node consumer

New module `src/worker/bridge-consumer.ts`, running inside the existing worker
process alongside (not replacing, during validation) the FTP importer:

- One `XREADGROUP` loop per stream type (`deals`, `orders`, `position-closed`),
  iterating all tracked accounts, consumer group `worker`.
- `deals-stream` → upsert `BridgeDeal` (unique `accountId+dealNo`) → `XACK` → later `XTRIM`.
- `orders-stream` → upsert `BridgeOrder` (unique `accountId+orderTicket`).
- `position-closed-stream` → upsert `BridgePosition` (unique `accountId+positionNo`),
  populating `mae`/`mfe`/entry/exit/duration from the enriched event payload.
- Field mapping lives in one module (`src/worker/bridge-mapper.ts`) so cutover
  (`BridgePosition` → `Position`, etc.) is a target-table swap, not a rewrite.
- Error handling: a failed upsert leaves the entry unacknowledged (retried on the next
  `XCLAIM` pass); a per-entry retry counter triggers a logged dead-letter warning after
  N attempts so one bad record can't block a stream indefinitely.

**`AccountSnapshot` / `OpenPosition` bridge sync** (extends the existing
`src/worker/equity-sampler.ts` 60s pass, reusing data it already fetches from Redis):

- `AccountSnapshot`: upsert (single row per account) from the same `Mt5LiveInfo` the
  sampler already reads; `sourceFileName` set to a `"bridge-live"` marker to
  distinguish from FTP-derived rows.
- `OpenPosition`: delete-all + recreate from the same `Mt5Position[]` the sampler
  already reads (mirrors the existing FTP importer's full-replace pattern).
- No validation gate — ships live immediately (see rollout).

### 5. Rollout

1. Ship bridge changes + Redis schema + shadow tables + Node consumer. FTP path is
   completely untouched and remains primary/authoritative for `Position`/`Deal`. The
   `AccountSnapshot`/`OpenPosition` bridge-sourced upserts go live immediately in this
   same step (no gate — see reasoning above).
2. `scripts/compare-bridge-ftp.ts` diffs `BridgePosition`/`BridgeDeal` against
   `Position`/`Deal` per account: flags missing rows and profit/price deltas beyond a
   tolerance.
3. Once matching consistently across all tracked accounts for an agreed observation
   window, cut over: the consumer's write target switches from `Bridge*` tables to the
   real `Position`/`Deal`/`Order` tables (via the centralized mapper module).
4. FTP worker code (`src/worker/index.ts` FTP-poll + cheerio parse path) is disabled,
   then removed in a later cleanup change once cutover has been stable.

## Testing

- Unit tests for the bridge's running MAE/MFE/peak-equity tracking logic (pure
  functions, testable without a live MT5 connection) — mirrors the existing
  `equity-sampler.test.ts` pattern.
- Unit tests for `bridge-mapper.ts` field mapping (raw MT5 API shape → Prisma row
  shape), covering the same edge cases the parser tests already cover (missing
  optional fields, symbol/pip precision).
- Integration-style test for the Node consumer against a fake Redis stream (existing
  `node --import tsx --test` pattern, no new test framework).
- `scripts/compare-bridge-ftp.ts` doubles as both a one-off validation script and a
  repeatable check during the parallel-run window.

## Open questions / explicitly deferred

- Exact tolerance thresholds for `compare-bridge-ftp.ts` (e.g. profit delta due to
  MT5 rounding) — decide during implementation of that script, not blocking design
  approval.
- Whether `Order` data ends up feeding any dashboard-visible feature — none planned
  yet; captured purely for future-proofing per requirements.
