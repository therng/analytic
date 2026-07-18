# Architecture: Data Models

Living reference for `prisma/schema.prisma` — what each model is for, who writes it, who reads it, and its lineage status. Built from a producer/consumer grep audit + code reading, not narrated from any prior doc or session.

## Data path

```
MT5 terminal → Python bridge (bridge_v2) → Redis (streams + live hashes) → Node worker → PostgreSQL → Next.js API → dashboard UI
```

Three worker lineages coexist during migration (see CLAUDE.md "Worker migration in progress"):
- `src/worker/` — legacy, still live in `docker-compose.yml`
- `src/worker-v2/` — current production path, live side-by-side with legacy
- `src/worker-v3/` — scaffolding only, no npm script yet, partial implementation (see `docs/superpowers/plans/worker-v3-implementation-plan.md`)

`src/worker-v2/mt5-enums.ts` and `src/worker-v3/mt5-enums.ts` are byte-identical twins (no cross-import possible between the two worker trees) — any enum-decode change must land in both.

## Model inventory

Status legend: **live** = has both a writer and a reader today · **staged** = writer and/or reader not wired yet but referenced in an active worker-v3 plan · **dead** = zero writer and zero reader anywhere in `src/`, `bridge_v2/`, confirmed by grep, not referenced in any active plan.

| Model | Status | Producer | Consumer | Notes |
|---|---|---|---|---|
| `TradingAccount` | live | `bridge-accounts.ts` (`ensureBridgeAccounts`) | almost everything (`account-resolver.ts`, `preaggregated-cache.ts`, `account-data.ts`, live-sync, aggregate-performance) | Root entity. `brokerUtcOffsetMinutes` gates all time-based ingestion (CLAUDE.md "Broker offset"). `marginMode`/`tradeMode` carry MT5's accounting system (netting/hedging) and account type (demo/contest/real) — read from the Redis live hash. |
| `AccountSnapshot` | live | `live-sync.ts`, `equity-sampler.ts` | `account-data.ts` | Latest balance/equity/margin/marginLevel — source of truth per the source-boundary table below. |
| `OpenPosition` | live | `equity-sampler.ts`, `live-sync.ts` | read via `TradingAccount.openPositions` include (not a direct `.findMany`) | Floating P/L, open exposure, open counts boundary. |
| `Position` | live | `position-reconstructor.ts` (v2/v3), `bridge-consumer.ts`, `history-checkpoint.ts` | `trade-history.ts`, `calculate-report-results.ts`, `account-data.ts` | Win rate / profit factor / Sharpe / averaged-metrics / MAE-MFE boundary (closed trades only). `mae`/`mfe` feed the correlation metrics described below. |
| `Deal` | live | `history-checkpoint.ts`, `bridge-consumer.ts`, `deal-consumer.ts` | `calculate-report-results.ts`, `position-reconstructor.ts` | Balance curve / growth / drawdown / AHPR-GHPR / LR-correlation boundary. `direction` carries MT5's `DEAL_ENTRY` (in/out/inout/out_by) under a shorter field name. |
| `EquitySnapshot` | live | `equity-sampler.ts` | `equity-curve.ts`, `preaggregated-cache.ts` | Intraday equity/margin, 60s cadence, feeds the 1D sparkline. 7-day retention. Supersedes `EquityState` (see Technical Debt). |
| `PositionExcursion` | live | `equity-sampler.ts` | `position-excursion.ts` | Per-position P/L excursion samples alongside equity snapshots. |
| `Order` | live | `bridge-consumer.ts`, `history-checkpoint.ts`, `order-consumer.ts` | read via `TradingAccount.orders` include, feeds position reconstruction | `state` is decoded to the MT5 `ORDER_STATE` name (not the raw numeric code); `fillPolicy`/`orderTimeType` carry MT5's `type_filling`/`type_time`. |
| `AccountReportResult` | live, cache-only | `calculate-report-results.ts` | `preaggregated-cache.ts` (`getAccountVersionProbe`) — **only** for its `computedAt`/`sourceReportDate` timestamps | **Not an authoritative data source.** The UI's displayed metrics are recomputed live per request in `preaggregated-cache.ts` from `Position`/`Deal` using the same `analytics.ts` helpers. Writing a column here alone never reaches the UI — every metric must be wired into both paths (see Derived Analytics Metrics). |
| `BridgeHistoryCheckpoint` / `BridgeHistoryChunk` / `BridgeHistoryRecord` | live | `history-checkpoint.ts` | `history-checkpoint.ts`, `trade-history.ts` | Durable backfill checkpoint state — see CLAUDE.md "History Backfill and Durability". |
| `WorkerMessageFailure` | **staged** (worker-v3) | none yet | none yet | Referenced across 3 worker-v3 plan docs (`docs/superpowers/plans/2026-07-16-history-first-dashboard-worker-v3.md`, `2026-07-17-worker-v3-package3a-schema-and-corrupted-lifecycle.md`, `worker-v3-implementation-plan.md`). Dead-letter tracking for v3 — do not delete, it's mid-flight. |
| `ClosedPosition` | **staged** (worker-v2/v3) | `position-reconstructor.ts` (v2/v3), `history-checkpoint.ts`, `bridge-consumer.ts` | `aggregate-performance.ts` | Confirmed "partial" in the worker-v3 plan — lacks fields the v3 spec wants (entry/exit order & deal id arrays, partial-close count, close reason, fully-closed flag). Live writer + live reader, but incomplete; part of the v2→v3 cutover, not dead. |
| `AccountPerformanceBySymbol` / `AccountPerformanceByStrategy` | live | `aggregate-performance.ts` | `route.ts` (per-symbol / per-strategy breakdown API) | |
| `EconomicEvent` | live | `economic-events-poller.ts` | `route.ts` (`/api/economic-events`) | Forex Factory source, Bangkok time. |
| `SocialUser` | live | `route.ts`, `auth.ts` | `auth.ts` | Sparkline-reaction username/auth, unrelated to trading data. |

## Source-boundary rules

| Data | Source |
|---|---|
| Win rate, profit factor, Sharpe, averaged metrics, MAE/MFE correlations, Z-Score, holding-time stats | `Position` |
| Balance curve, growth, drawdown, AHPR/GHPR, LR correlation/std-error | `Deal` |
| Floating P/L, open exposure, open counts | `OpenPosition` / Redis live hash |
| Latest balance, equity, margin, marginLevel | `AccountSnapshot` / Redis live hash |
| Intraday equity, margin load, runtime excursions | `EquitySnapshot` / `PositionExcursion` |
| Trade P/L | always `profit + swap + commission`, never `profit` alone |

`AccountReportResult` is a precomputed cache over the above, never an independent source.

## Order & account semantics (MT5 enum decoding)

MT5 order and account records carry several fields as raw numeric enum codes. The Redis/bridge layer preserves the raw values; the Node worker decodes them to named strings at the mapping step, following the existing pattern in `mt5-enums.ts` (`decodeDealType`, `decodeDealEntry`, `decodePositionSide`).

| Field | MT5 enum | Decoded values |
|---|---|---|
| `Order.state` | `ORDER_STATE` | `started` / `placed` / `partial` / `filled` / `canceled` / `rejected` / `expired` / `request_add` / `request_modify` / `request_cancel` |
| `Order.fillPolicy` | `ORDER_TYPE_FILLING` | `fok` / `ioc` / `return` / `boc` |
| `Order.orderTimeType` | `ORDER_TYPE_TIME` | `gtc` / `day` / `specified` / `specified_day` |
| `TradingAccount.marginMode` | `ACCOUNT_MARGIN_MODE` | `retail_netting` / `exchange` / `retail_hedging` |
| `TradingAccount.tradeMode` | `ACCOUNT_TRADE_MODE` | `demo` / `contest` / `real` |

`TradingAccount.marginMode`/`tradeMode` are sourced from the Redis live hash (`bridge_v2` publishes `margin_mode`/`trade_mode` on every live tick) rather than from a historical stream, so they reflect the account's current accounting mode as of the last live sync.

**Not implemented:** MT5 execution mode (`SYMBOL_TRADE_EXECMODE` — Instant/Request/Market/Exchange) is a symbol/account property the Python bridge does not currently query anywhere — persisting it requires new bridge-side polling, not just a mapping change.

## Derived analytics metrics

`src/lib/trading/analytics.ts` (plus `trade-distributions.ts` for the regression/correlation pieces) computes a set of MT5-report-style performance metrics. Every metric here is implemented exactly once and called from **both** the cache-write path (`calculate-report-results.ts` → `AccountReportResult`) and the live per-request path (`preaggregated-cache.ts` → API response) — this dual call site is mandatory, not incidental, because `AccountReportResult` is cache-only (see Model Inventory).

| Metric | Definition | Range / scale |
|---|---|---|
| AHPR (Arithmetic Holding-Period Return) | Arithmetic mean of per-trade returns, from the Deal-derived balance curve, trading events only | percent number (e.g. `2.34`), matching `winPercent`/`balanceDrawdown*Pct` convention |
| GHPR (Geometric Holding-Period Return) | See below | percent number |
| Z-Score | Runs-test statistic on the win/loss sequence — see below | ≈ [-3, 3] |
| LR Correlation | Pearson correlation between the balance curve and its own least-squares regression line | [-1, 1] |
| LR Standard Error | Residual standard error of the balance curve against that regression line | ≥ 0, same units as balance |
| Correlation(Profit, MFE) | Pearson correlation between closed-trade net P/L and Maximum Favorable Excursion | [-1, 1] |
| Correlation(Profit, MAE) | Pearson correlation between closed-trade net P/L and Maximum Adverse Excursion | [-1, 1] |
| Correlation(MFE, MAE) | Pearson correlation between MFE and MAE | [-1, 1] |
| Min / Max / Avg holding time | Position open-to-close duration, unified on `computeHoldingSeconds` | seconds |

All Pearson correlations above are derived from the same `computeLinearRegression` fit (already computed for the MFE/MAE scatter panel): `r = sign(slope) · √(R²)`.

### GHPR

For a sequence of *n* per-trade returns *r₁, r₂, …, rₙ*:

```
        ┌   n         ┐ 1/n
GHPR  = │  ∏  (1 + rᵢ) │      −  1
        └  i=1        ┘
```

i.e. the geometric mean of the per-trade growth factors, expressed as a return.

### Z-Score

Runs test for win/loss-sequence non-randomness (Ralph Vince / MT5 strategy-tester formula):

**Variables**
- *N* — total number of trades
- *W* — number of winning trades (MT5 convention: a break-even trade, net P/L = 0, counts as a win, unlike Ralph Vince's original method which counts it as a loss)
- *L* — number of losing trades, *N = W + L*
- *R* — number of runs (a run is a maximal streak of consecutive trades on the same side of the win/loss line)
- *P = 2WL*

**Formula**

```
      N(R − 0.5) − P
Z = ────────────────────
     √( P(P − N) / (N − 1) )
```

A value near `0` indicates the win/loss sequence is statistically indistinguishable from random; `|Z| ≥ 3` indicates strong sequential dependence between consecutive trade outcomes.

## MT5 Report Coverage Matrix

Traceability matrix against `docs/Analytics Report & Metrics.md` (the MetaTrader 5 report/metrics reference). Built from a grep audit of `src/lib/trading/`, `src/components/trading-monitor/`, and `prisma/schema.prisma` — not narrated. Status legend: **implemented** = computed and rendered in the dashboard · **computed, not surfaced** = the value exists in a server-side function/API payload but no `.tsx` component renders it · **not built** = no code path exists · **N/A** = Strategy Tester–only concept, doesn't apply to a live-account dashboard.

### §1 Report tabs & graphs

| Report item | Dashboard equivalent | Status | Notes |
|---|---|---|---|
| Summary tab | KPI chips (`metric-registry.ts` — gain/dd/pips/trades/opens/deposit/withdrawal) + `BotPnLPanel.tsx` balance curve | implemented | |
| Profit/Loss tab | `summarizeTrades`/`summarizeClosedPositions` (`analytics.ts:1476,976`) for gross profit/loss/profit factor; `computeAlgoTradingPercent` (`analytics.ts:831`) for manual-vs-algo split | partial | MT5's 3-way manual/algo/copy split is 2-way here (manual vs algo, comment-heuristic based); no month/year pivot table in UI, current-timeframe scalars only |
| Long/Short tab | `getLongTradeWinPercent`/`getShortTradeWinPercent` (`analytics.ts:1122,1143`) for win-rate-by-direction; `longTradesTotal`/`shortTradesTotal` count bar in `PerformanceBars.tsx:657` | split | Trade-count ratio is rendered; win-rate-by-direction is computed (`preaggregated-cache.ts`, `account-data.ts`) but no component consumes it |
| Symbols tab | `bySymbol`/`openBySymbol` (`preaggregated-cache.ts:1357-1423`, `types.ts`) | computed, not surfaced | Typed and computed server-side; zero `.tsx` consumer found |
| Risks tab | `PerformanceBars.tsx` (Sharpe/Profit Factor/Recovery Factor gauges) + `PerformanceRadar.tsx` (max-drawdown score) + `max-deposit-load` KPI chip | implemented | |
| Drawdown graph | `DrawdownPanel.tsx` — balance + equity drawdown curves overlaid on the balance chart | implemented | Falls back to balance-derived drawdown when `EquitySnapshot`'s 7-day retention window is empty (`DrawdownPanel.tsx:40-45`) |
| Deposit Load graph | — | not built | `computeDepositLoadPercent` (`analytics.ts:1214`) only feeds a scalar KPI chip and `maximalDepositLoad` cache field (`preaggregated-cache.ts:905`); no time-series chart exists |

### §2 Trade history structures (field-level)

| Record | Prisma model | Coverage |
|---|---|---|
| Orders | `Order` (`schema.prisma:346-372`) | Full — symbol, type, `orderTicket`(#), volume, `priceOpen`/`priceCurrent`(Price), state, sl/tp, `timeSetup`(Time), comment. `fillPolicy`/`orderTimeType` decoded per the enum table above. |
| Deals | `Deal` (`schema.prisma:190-220`) | Full except Δ — direction(in/out/inout), volume, price, profit, fee, swap, commission, comment, `balance`(balanceAfter). MT5's Δ (open/close price delta) isn't a stored column, derivable from linked deal pairs but not materialized. Balance/funding rows identified via `isBalanceDeal`/`isFundingDeal` (`analytics.ts:397,405`). |
| Positions | `Position` (`schema.prisma:157-188`) | Full — open/close time, volume, `openPrice`/`closePrice`, profit, swap, commission, pips, mae/mfe. MT5's "weighted average price" framing assumes partial-fill aggregation, which happens upstream in `position-reconstructor.ts`, not recomputed at read time. |

### §3 Testing report parameters

| Parameter | Status | Notes |
|---|---|---|
| History Quality, Bars/Ticks/Symbols, OnTester Result | N/A — tester-only | No backtest engine in this repo; live MT5 bridge data only |
| Initial Deposit/Withdrawal | implemented | `deposit`/`withdrawal` KPI chips, `buildFundingTotals` (`analytics.ts:1190`) |
| Total Net Profit, Gross Profit/Loss | implemented | `summarizeTrades`/`summarizeClosedPositions` |
| Balance/Equity Drawdown (Absolute/Maximal/Relative) | implemented | `computeAbsoluteDrawdown` (`analytics.ts:1203`), `computeBalanceDrawdown` (`analytics.ts:1399`); equity variant per source-boundary table above |
| Profit Factor | implemented | `analytics.ts:1050` |
| Recovery Factor | implemented | `calculate-report-results.ts:130`, `preaggregated-cache.ts:927-968` |
| AHPR / GHPR | implemented | `analytics.ts:1319,1328` — formulas documented above |
| Expected Payoff | implemented | `analytics.ts:1051` |
| Sharpe Ratio | implemented | `computeSharpeRatio`/`computeAnnualizedSharpeRatio` (`analytics.ts:641,656`) |
| LR Correlation / LR Standard Error | implemented | `computeLinearRegression` (`trade-distributions.ts:11`) — formulas documented above |
| Margin Level | implemented | `margin-level` KPI chip, sourced from `AccountSnapshot`/Redis live |
| Z-Score | implemented | `computeZScore` (`analytics.ts:1076`); MT5 break-even-counts-as-win convention documented above |
| Correlation(Profit,MFE) / (Profit,MAE) / (MFE,MAE) | implemented | `calculate-report-results.ts:98-104` |
| Position Holding Times (Min/Max/Avg) | implemented | `summarizeHoldingTime` (`analytics.ts:892`) |

### §4 Testing report diagrams

| Diagram | Status | Notes |
|---|---|---|
| Entries by Hours/Weekdays/Months (session color-coded) | not built | `ProfitHeatmapPanel.tsx` is a GitHub-style daily-P/L calendar (day × week-of-year) — a different diagram, not an hour/weekday entry histogram. No Asian/European/American session color-coding exists anywhere in the codebase. |
| Profits/Losses by Hours/Weekdays/Months | not built | Same gap as above |
| MFE-Profits Distribution | implemented | `TradeDistributionPanel.tsx` mode `"mfe-profit"` |
| MAE-Profits Distribution | implemented | `TradeDistributionPanel.tsx` mode `"mae-profit"` |
| Profit vs Holding-Time Distribution | implemented | `TradeDistributionPanel.tsx` mode `"profit-time"`, `formatHoldingDuration` (`trade-distribution-chart.ts:180`) |

### §5 Five key metrics + thresholds

All five are gauged, spread across three components rather than one panel:

| Metric | Component | Zone thresholds vs MT5 spec |
|---|---|---|
| Sharpe Ratio | `PerformanceBars.tsx` (`SHARPE_ZONES`) | House-tuned: poor ≤0.5 / fair ≤2.0 / good ≤3.0 / great ≤5.0 — code comment states these are "benchmark thresholds tuned for retail FX accounts," not a literal port of the spec's <0/<1.0/≥1.0/≥3.0 bands |
| Maximum Drawdown | `PerformanceRadar.tsx` (inverted score, `maxDrawdownPct`) | Spec target <20-30%; radar zone constants not verified in this pass |
| Recovery Factor | `PerformanceBars.tsx` (`RECOVERY_ZONES`) | poor ≤1 / fair ≤3 / good ≤5 / great ≤7 — aligns with spec's ">3 is ideal" at the fair/good boundary |
| Profit Factor | `PerformanceBars.tsx` (`PROFIT_FACTOR_ZONES`) | poor ≤1.0 / fair ≤1.5 / good ≤2.5 / great ≤4.0 — matches spec's break-even-at-1.0 threshold exactly |
| Maximum Deposit Load | `max-deposit-load` KPI chip (`metric-registry.ts:86`) | Scalar display only, no zone/threshold coloring |

## Technical Debt & Pending Migrations

### Priority: delete 4 dead models

Confirmed via grep across `src/`, `bridge_v2/`, `scripts/` — zero `prisma.<model>.{create,upsert,update,delete,findMany,findFirst,findUnique,count,aggregate}` calls anywhere, and no reference in any active worker-v3 plan (which would instead mark a model "staged"). Each was superseded by a model that *is* live. **Leaving these in the schema risks accidental reuse** — a future change could read/write one of these thinking it's the current source, silently producing data nothing consumes.

| Model | Why it's dead | Superseded by |
|---|---|---|
| `Symbol` | Never wired up. No writer ever existed. | — |
| `EquityState` | Early design intended this as the equity/drawdown source. Also uses raw `snake_case` field names with no `@map`/`@@map`, breaking this schema's naming convention. | `EquitySnapshot` |
| `PositionState` | Early design intended this as the MAE/MFE source. Its relation to `OpenPosition` (`[account_number, position_id]` → `[tradingAccountId, positionNo]`) requires `account_number` to hold a `TradingAccount.id` (cuid) despite every other model using that field name for the broker account number — a footgun if anyone ever revives it as-is. | `Position.mae`/`Position.mfe` + `PositionExcursion` |
| `RiskMetricsSnapshot` | Never wired up on either side. | — |

Deletion plan (Phase 1 of `docs/superpowers/plans/2026-07-18-mt5-schema-and-analytics-metrics-plan.md`): drop the 4 models plus their back-relations on `TradingAccount`/`OpenPosition`. Low risk — nullable-add-only pattern doesn't apply here, but there are zero writers, so no in-flight data loss is possible.

### Other pending migrations

- **Naming-convention pass** — `ClosedPosition`/`Strategy`/`EconomicEvent` still use inconsistent `@@map`/`@map` conventions relative to the rest of the schema. Deferred: `ClosedPosition` is written live by worker-v2/v3, so a table rename needs a write-quiesce window, not a rolling deploy.
- **`ClosedPosition` precision** — still using untyped `Decimal` columns, unlike every other live model's `@db.Decimal(28,8)`. Needs an `ALTER COLUMN TYPE` migration; check row count before running (see `opinionated-prisma:migration-safety`).
- **MT5 execution mode** — not persisted; blocked on new bridge-side polling (see Order & Account Semantics above).
- **UI gauge display for the derived analytics metrics above** — not built. Z-Score and LR Correlation are bidirectional ("good = near zero", not "higher is better") and don't fit the existing `PerformanceBars.tsx` ascending-zone gauge shape; new zone thresholds are a design decision, not to be guessed at.
- **Long/Short win-rate and Symbols-tab UI** — `getLongTradeWinPercent`/`getShortTradeWinPercent` and `bySymbol`/`openBySymbol` are computed and typed end-to-end but have zero UI consumer (see MT5 Report Coverage Matrix §1). Only trade *count* by direction is rendered today.
- **Deposit Load time-series graph** — `computeDepositLoadPercent` only backs a scalar KPI chip; no chart plots it over time the way `DrawdownPanel.tsx` does for drawdown.
- **Entries/Profits-by-Hour-Weekday-Month diagrams with session color-coding** — not built anywhere; `ProfitHeatmapPanel.tsx` is a different diagram (daily P/L calendar, not an entry-time histogram).
