# Growth Calculation Reference

## What "Growth" Means

Growth in this dashboard is **MQL5-style compounded growth** — deposits and withdrawals do not distort the percentage. Each funding event starts a new segment; segments are compounded multiplicatively.

This is implemented in `computeCompoundedGrowth()` in `src/lib/trading/analytics.ts`.

---

## Core Algorithm: `computeCompoundedGrowth`

```
Input: deals[], start: Date | null, end: Date | null
Output: percentage (e.g. 12.5 means +12.5%)
```

### Step-by-step

1. Sort all deals by `time` ascending (tie-break by `dealNo`)
2. Walk each deal chronologically up to `end`
3. For each deal, determine if it's a **balance operation** (deposit/withdrawal) or a **trading deal**
4. Before the `start` window: just track running `balance` — establishes the starting point
5. When entering the `start` window: capture `periodStartBalance = balance`
6. **On balance operation** (deposit/withdrawal):
   - Compound the current segment: `growthFactor *= (balance / periodStartBalance)`
   - Reset: `periodStartBalance = newBalance` (after the funding event)
7. **On trading deal**: update `balance` (use `deal.balance` if non-null, else `balance += dealNet`)
8. After all deals: compound the final segment

```
finalGrowth = (growthFactor - 1) * 100
```

### Why `deal.balance` takes priority over accumulating `dealNet`

MT5 reports include a "Balance" column on every deal row — this is the running account total after that deal. Using it as an anchor corrects any floating-point drift from accumulating many small deal nets.

---

## Where Growth Is Computed in the Codebase

| Location | Function | Used for |
|---|---|---|
| `analytics.ts` | `computeCompoundedGrowth(deals, since, null)` | Main card `kpis.periodGrowth` |
| `analytics.ts` | `computeAllTimeGrowth(deals)` | All-time growth in growth panel |
| `analytics.ts` | `computeYearGrowth(deals, year)` | YTD and per-year breakdown |
| `account-data.ts` | `getTodayGrowthPercent()` | `today_growth_percent` in account list |
| `account-data.ts` | `getTodayWeekGrowthPercent()` | `week_growth_percent` in account list |
| `preaggregated-cache.ts` | `buildCalendarMonthlyPerformance()` | Month-by-month growth table |
| `preaggregated-cache.ts` | `getPipsSummaryRow()` | Growth column in pips summary |

---

## Deal Classification

```ts
function classifyBalanceOperation(type, comment, delta):
  "deposit" | "withdrawal" | "balance-adjustment" | "balance" | null
```

Returns `null` for trading deals (buy/sell), non-null for funding events.

**Match rules (checked in order):**

1. Text contains "deposit" → `"deposit"`
2. Text contains "withdraw" → `"withdrawal"`
3. Text contains "balance adjustment" → `"balance-adjustment"`
4. Text matches generic: credit/correction/bonus/fee/charge/interest/tax/agent/dividend → `"balance"`
5. `type === "balance"` and delta > 0 → `"deposit"`
6. `type === "balance"` and delta < 0 → `"withdrawal"`
7. Else → `null` (trading deal)

Where `text = "${type.toLowerCase()} ${comment.toLowerCase()}"`.

---

## Net PnL Formula

```
positionNetPnl = profit + swap + commission
```

`dealNet()` implements this. **Always use `dealNet()` — never use `profit` alone.**

- `commission` is typically negative (broker fee)
- `swap` is positive or negative (overnight rollover)

---

## Timeframe Windows

All timeframes use Bangkok timezone (UTC+7) via `src/lib/time.ts`.

| Timeframe | `since` date |
|---|---|
| `1d` | `startOfThaiDayInTableTime(reportTime)` (midnight Bangkok) |
| `1w` | `addBangkokDays(startOfDay, -6)` (rolling 7 days) |
| `1m` | `addBangkokDays(startOfDay, -30)` |
| `3m` | `addBangkokDays(startOfDay, -90)` |
| `6m` | `addBangkokDays(startOfDay, -180)` |
| `1y` | `addBangkokDays(startOfDay, -365)` |
| `all` | `null` (no filter) |

`reportTime` = anchor date derived from the most recent `reportDate` across account, snapshot, and open positions.

---

## Account List Sort Order

Default sort: `today_growth_percent` descending.

Tie-breakers (in order):
1. `today_net_pips` descending
2. `today_net_profit` descending
3. `balance` descending
4. `account_number` ascending (numeric)
