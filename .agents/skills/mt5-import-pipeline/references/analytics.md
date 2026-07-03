# Analytics Internals — `src/lib/trading/`

## Entry Point: `preaggregated-cache.ts`

`getAccountOverview(accountId: string, timeframe: string): Promise<AccountOverview>`

Returns the full dashboard data bundle for one account at one timeframe. Cached in-memory for `ACCOUNT_CACHE_REVALIDATE_MS` (5,000 ms). Cache is keyed on `(accountId, timeframe)` — a timeframe change invalidates the entry.

---

## Timeframes

`parseTimeframe(str)` converts a string to a `since` date in Bangkok timezone:

| Code | Since |
|---|---|
| `1D` | Start of today (Bangkok midnight) |
| `1W` | 7 days ago |
| `1M` | 1 calendar month ago |
| `3M` | 3 calendar months ago |
| `6M` | 6 calendar months ago |
| `1Y` | 1 year ago |
| `YTD` | Start of current year (Bangkok Jan 1 00:00) |
| `ALL` | No lower bound (all historical data) |

All timezone operations use `src/lib/time.ts` (`Asia/Bangkok`, UTC+7).

---

## Growth: `computeCompoundedGrowth`

**Source:** `Deal` table (balance operations + trading deals together)

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

**Note:** The `metrics.sharpe_ratio` field in `AccountReportResult` (computed from report HTML) uses MT5's equity log-return method which differs slightly. For dashboard display, the precomputed Sharpe from the HTML report is preferred. The `computeAnnualizedSharpeRatio` function is used for custom timeframe slicing.

> For the official MT5 Sharpe formula (equity + log returns + `sqrt(N)` annualization) → `mt5-report-parser/references/sharpe-sortino.md`.

---

## Pips: `positionPips()`

**Source:** `Position` table — computed at import time, stored in `Position.pips`

Formula depends on symbol type:
- FX pairs (5-digit): `(closePrice - openPrice) * 10000` (buy) or reversed (sell)
- FX pairs (3-digit JPY): `(closePrice - openPrice) * 100`
- Gold/XAUUSD: direct price difference

Pips are stored as a signed number (positive = profitable direction, negative = losing).

---

## Recompute Cache: `recomputeAccountReportResult`

**File:** `src/lib/trading/calculate-report-results.ts`

Called inside the worker transaction after every import. Reads from `Position` + `Deal` tables (same `tx`) and writes a single `AccountReportResult` row per account.

**Fields computed:**
- `profitFactor`: `grossProfit / abs(grossLoss)` from closed positions
- `winRate`: `profitTrades / totalTrades`
- `totalTrades`, `profitTrades`, `lossTrades`
- `avgWin`, `avgLoss`, `largestWin`, `largestLoss`
- `maxConsecutiveWins`, `maxConsecutiveLosses`
- Drawdown (absolute, maximal, relative) — recomputed from deal balance curve

**Critical:** `AccountReportResult` is a cache. Never query it as authoritative. Always recompute or use direct queries against `Position`/`Deal` for authoritative numbers.

---

## Analytics Module Structure

```
src/lib/trading/
├── preaggregated-cache.ts      ← Main entry, in-memory cache, timeframe routing
├── calculate-report-results.ts ← recomputeAccountReportResult (called from worker)
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
