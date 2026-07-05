# Analytics Internals — `src/lib/trading/`

## Entry Point: `preaggregated-cache.ts`

`getCachedAccountView(accountId: string, timeframe: Timeframe, kind: AccountCachedViewKind)`

Returns API-ready dashboard views from a per-account in-memory bundle. The bundle is invalidated by account, snapshot, report-result, and equity-snapshot version probes; each `kind`/timeframe view is derived from the same authoritative account bundle.

---

## Timeframes

Public dashboard/API timeframes normalize to these scopes in Bangkok time:

| Code | Since |
|---|---|
| `D` | Today intraday, fixed 0-23 hour axis |
| `1W` | 7 days ago |
| `1M` | 30 days ago |
| `3M` | 90 days ago |
| `6M` | 180 days ago |
| `1Y` | 365 days ago |
| `ALL` | No lower bound (all historical data) |

All timezone operations use `src/lib/time.ts` (`Asia/Bangkok`, UTC+7).

---

## Growth: `computeCompoundedGrowth`

**Source:** `Deal` table (funding operations + trading deals together)

**Algorithm (MQL5-style):**

1. Fetch deals ordered by `time` ascending within the timeframe
2. Identify balance operations (`isBalanceDeal = type "balance" or "credit"`) — these represent deposits and withdrawals
3. Segment the equity curve at each balance operation: each segment starts at the post-deposit balance
4. Compute compounded growth within each segment using: `(endBalance / startBalance) - 1`
5. Combine segments: `(1 + g1) × (1 + g2) × ... × (1 + gN) - 1`

**Why segmenting matters:** A deposit of $10,000 into an account with $1,000 would appear as 1,000% "growth" without segmentation. Segmenting treats each deposit as a new baseline, isolating trading performance from funding events.

Growth is expressed as a percentage (e.g., `12.5` = 12.5%).

---

## Drawdown: `computeBalanceDrawdown`

**Source:** `Deal` table (balance curve via `balanceAfter`)

**Algorithm:**

1. Extract balance curve: `[(time, balanceAfter)]` for all deals with non-null `balanceAfter`
2. Walk the curve tracking `runningMax = max(balance seen so far)`
3. At each point: `currentDD = (runningMax - current) / runningMax * 100`
4. `maxDrawdown = max(currentDD)` across all points

Returns: `{ maxDrawdown: number, maxDrawdownAmount: number }` as percentage and absolute amount.

**Why Deal, not Position:** Positions miss intraday equity moves. A position that dipped 500 pips before recovering would show zero drawdown using position close prices. Deal-based balance curve captures each increment as it happens.

---

## Sharpe: `computeAnnualizedSharpeRatio`

**Source:** `Deal` table (daily P/L aggregated from `profit + commission + swap`)

**Algorithm:**

1. Group trading deals by calendar day (Bangkok timezone)
2. Sum `profit + commission + swap` per day → daily P/L series
3. Compute mean and standard deviation of daily P/L
4. `sharpeDaily = mean / stdDev`
5. `sharpeAnnual = sharpeDaily * sqrt(252)` (252 trading days per year)

Returns 0 if fewer than 2 data points or stdDev is 0.

`AccountReportResult.sharpeRatio` is a cache written from current `Deal` data. Do not prefer parsed HTML report metrics in this project.

---

## Pips: `positionPips()`

**Source:** `Position` table — mapped from bridge closed-position payloads and stored in `Position.pips`

Formula depends on symbol type:
- FX pairs (5-digit): `(closePrice - openPrice) * 10000` (buy) or reversed (sell)
- FX pairs (3-digit JPY): `(closePrice - openPrice) * 100`
- Gold/XAUUSD: direct price difference

Pips are stored as a signed number (positive = profitable direction, negative = losing).

---

## Recompute Cache: `recomputeAccountReportResult`

**File:** `src/lib/trading/calculate-report-results.ts`

Called after bridge stream batches that mutate `Position` or `Deal`. Reads authoritative `Position` + `Deal` rows and writes a single `AccountReportResult` row per account.

**Fields computed:**
- `profitFactor`: `grossProfit / abs(grossLoss)` from closed positions
- `winRate`: `profitTrades / totalTrades`
- `totalTrades`, `profitTrades`, `lossTrades`
- `avgWin`, `avgLoss`, `largestWin`, `largestLoss`
- `maxConsecutiveWins`, `maxConsecutiveLosses`
- Drawdown (absolute, maximal, relative) — recomputed from deal balance curve

**Critical:** `AccountReportResult` is a cache. Never query it as authoritative. Always recompute or use direct queries against `Position`/`Deal` for authoritative numbers.

## Metric Registry

`src/lib/trading/metric-registry.ts` is the dashboard metric contract. Every UI metric should have:

- source (`deal`, `position`, `open-position`, `snapshot`, `redis-live`, `equity-snapshot`, `position-excursion`, or `derived-cache`)
- formula
- timeframe scope
- API field
- display target and formatter

Run `node --import tsx --test src/lib/trading/metric-registry.test.ts` after adding or changing dashboard metric wiring.

---

## Analytics Module Structure

```
src/lib/trading/
├── preaggregated-cache.ts      ← Main entry, in-memory cache, timeframe routing
├── calculate-report-results.ts ← recomputeAccountReportResult (called from worker)
├── metric-registry.ts          ← UI metric source/formula/display contract
├── analytics.ts                ← Core computation functions
│   ├── computeCompoundedGrowth
│   ├── computeBalanceDrawdown
│   └── computeAnnualizedSharpeRatio
├── account-data.ts             ← Prisma query helpers for accounts
└── core/
    ├── growth.ts               ← Growth segmentation logic
    └── downsample.ts           ← Balance curve downsampling for charts
```

---

## Common Analytics Issues

| Symptom | Cause | Fix |
|---|---|---|
| Growth shows 0% after deposit | New segment not started at deposit | Check `isBalanceDeal` classification; ensure balance ops segment the curve |
| Drawdown spikes on first deal | Running max starts at 0, not initial deposit | Initialize `runningMax = initialDeposit` (from first balance deal) |
| Sharpe unrealistically high | Division by near-zero stdDev | Add `stdDev < epsilon` guard returning 0 |
| `AccountReportResult` stale after reimport | `recomputeAccountReportResult` not called | Always call inside the worker transaction, step 7 |
| Pips wrong for JPY pair | Wrong pip scale | Check `positionPips()` symbol detection regex for 3-digit pairs |
| Cache returns wrong timeframe data | Cache key not including timeframe | Verify `(accountId, timeframe)` composite key in cache store |
