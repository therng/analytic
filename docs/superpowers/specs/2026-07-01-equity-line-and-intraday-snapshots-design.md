# Equity line on 1D sparkline + intraday equity/margin/per-trade snapshots

> **PARTIALLY MERGED:** Keep the `EquitySnapshot` / `PositionExcursion` sampling and 1D equity-line design where it matches the active Bridge/Redis-only contract. References to FTP loops, `WORKER_RUN_ONCE`, `EquityHistory`, report imports, or report-derived cache behavior are superseded by `docs/superpowers/specs/2026-07-04-bridge-only-metric-remap-design.md`.

Date: 2026-07-01

## Goal

1. Show an equity line alongside the existing balance line on the 1D sparkline chart (`SparklineChart` in `src/components/trading-monitor/MonitorShared.tsx`), sourced from Redis (live) + intraday DB snapshots (today's history).
2. Start persisting intraday equity/margin data (account-level) and per-position floating P/L (trade-level), so a future MAE/MFE feature has the raw data it needs. **Computing MAE/MFE itself is out of scope for this spec** — only storage.
3. Card header number switches from static `balance` to live `equity` (already shipped ahead of the rest of this spec — see "Card header" section below).

## Card header (shipped)

`DashboardCard.tsx`'s header stat (`sp-balance`) previously showed `accountSource.balance`. It now shows live equity (`liveLiveInfo?.equity ?? accountSource.equity`), refreshed automatically via the existing 2s `useLiveData` poll — no new polling was introduced. Hovering the sparkline still overrides the header with the historical **balance** at the hovered point (unchanged behavior); the `aria-label` prefix switches between "Equity" and "Balance" to match whichever value is actually shown.

## Why two tables, not one

MAE/MFE (Maximum Adverse/Favorable Excursion) is conventionally a **per-trade** metric — the worst/best unrealized P/L while a single position is open. Account-level equity cannot be decomposed back into per-trade excursions once more than one position is open concurrently, so a per-trade feature needs per-position floating-P/L samples, not just account equity.

The equity **line on the chart** only ever needs account-level equity — that part is not blocked by the MAE/MFE decision and uses `EquitySnapshot` only.

## Schema changes (`prisma/schema.prisma`)

Two new tables. No changes to any existing table.

```prisma
model EquitySnapshot {
  id               String         @id @default(cuid())
  tradingAccountId String         @map("account_id")
  ts               DateTime       // sample time, truncated to the minute
  equity           Decimal        @db.Decimal(28, 8)
  margin           Decimal        @db.Decimal(28, 8) // margin used
  balance          Decimal        @db.Decimal(28, 8)
  tradingAccount   TradingAccount @relation(fields: [tradingAccountId], references: [id], onDelete: Cascade)

  @@unique([tradingAccountId, ts])
  @@index([tradingAccountId, ts])
  @@map("EquitySnapshot")
}

model PositionExcursion {
  id               String         @id @default(cuid())
  tradingAccountId String         @map("account_id")
  positionTicket   String         @map("position_ticket") // Mt5Position.ticket, stringified
  ts               DateTime       // sample time, truncated to the minute
  profit           Decimal        @db.Decimal(28, 8) // floating P/L for this position at ts
  tradingAccount   TradingAccount @relation(fields: [tradingAccountId], references: [id], onDelete: Cascade)

  @@unique([tradingAccountId, positionTicket, ts])
  @@index([tradingAccountId, positionTicket, ts])
  @@map("PositionExcursion")
}
```

`TradingAccount` gains two new relation fields (`equitySnapshots EquitySnapshot[]`, `positionExcursions PositionExcursion[]`), alongside the existing `equityHistory`.

Both tables are pruned to a **7-day retention window** — old rows are deleted, not archived (the existing daily `EquityHistory` table already covers permanent history).

## Worker changes (`src/worker/index.ts`)

The worker currently runs a single sequential loop: `while (true) { processReports(); sleep(WORKER_POLL_MS) }` (FTP import only — it never touches Redis MT5 data today). This is a **separate, independent interval**, not folded into that loop:

- On boot (in `runWorker()`, skipped entirely when `WORKER_RUN_ONCE=true` since that mode is a one-shot import pass), register `setInterval(sampleEquity, 60_000)`.
- `sampleEquity()`:
  1. `prisma.tradingAccount.findMany({ select: { id: true, accountNo: true } })`.
  2. For each account, call `getMt5LiveData(accountNo)` (existing helper in `src/lib/redis-mt5.ts`, already used by `/api/accounts/[id]/live`).
  3. If `live` is present, upsert one `EquitySnapshot` row keyed on `(tradingAccountId, ts)` where `ts` = now truncated to the minute (`equity`, `margin`, `balance` from the live payload).
  4. For each entry in `positions` (per-position `ticket` + `profit`), upsert one `PositionExcursion` row keyed on `(tradingAccountId, positionTicket, ts)`.
  5. Any Redis error for a given account is caught and logged per-account (skip that account, continue the batch) — a Redis outage must not crash the worker or block FTP import.
- A second `setInterval` (hourly) runs the prune pass: `DELETE FROM EquitySnapshot/PositionExcursion WHERE ts < now() - 7 days`.
- No change to `WorkerHeartbeat`/health semantics — this sampler is independent of FTP poll health and does not affect `/health`.

## API changes

Extend the existing `1d`-timeframe response (the route backing `balanceDetail` — `src/app/api/accounts/[id]/balance/route.ts` / `preaggregated-cache.ts`) with a new field, populated only when `timeframe === "1d"`:

```ts
equityCurve: BalanceEventPoint[] // same point shape as balanceCurve
```

Built from:
- `EquitySnapshot` rows for the account for the current Bangkok day (`src/lib/time.ts` boundary helpers), ordered by `ts`.
- A live point appended for "now", same pattern as the existing `withLivePoint()` balance logic — sourced from the account's current Redis `equity` value (already available via `useLiveData` on the client, or fetched server-side).

For other timeframes, `equityCurve` is omitted/empty — intraday snapshots are only meaningful for the 1D view.

## Frontend changes (`src/components/trading-monitor/MonitorShared.tsx`)

`SparklineChart` gains a new optional prop `equityPoints?: Array<ChartPoint | BalanceEventPoint>`, rendered only when `timeframe === "1d"` and non-empty:

- Reuses `buildDailyTimePoints` positioning logic, but the value scale (min/max) must be computed **across both series combined** so the two lines sit correctly relative to each other in one frame (a shared baseline/range, not two independently-scaled lines).
- Rendered as a second `<path>` stroke, no fill, layered above/below the existing balance fill+line.
- Color: `var(--neutral, #4da8f5)` — visually distinct from the existing balance stroke (`--account-chart`). No new design token needed.
- No new interactive affordances (no highlight/tooltip dot) for the equity line in this pass — it's a visual reference line only.

## Testing

- Extend/add a `node --test` file for the equity-curve builder (API/preaggregated-cache logic) covering: no snapshots for today (empty curve), snapshots + live point merge (same append/replace-last-if-within-60s logic as balance), timeframe other than `1d` (curve omitted).
- Manual verification: `npm run build`, `npm run lint`, and visual check in dev server that the equity line renders alongside balance on an account with live Redis data.
- Worker sampler is integration-shaped (Redis + Prisma) — no isolated unit test planned; verified via `docker-compose` stack smoke check (existing `/docker-debug` skill) after deploy.

## Out of scope

- Computing MAE/MFE itself (the per-trade excursion analysis that consumes `PositionExcursion`).
- Any UI for margin-used history (spec covers storage only; margin is captured in `EquitySnapshot` for future use).
- Backfilling historical intraday data — snapshots start accumulating only from when the worker change ships; there's no way to reconstruct the past.
