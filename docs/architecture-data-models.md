# Architecture: Data Models

Living reference for `prisma/schema.prisma` — what each model for, who write, who read, lineage status. Built from producer/consumer grep audit + code read, not narrated from prior doc or session.

## Data path

```
MT5 terminal → Python bridge (`bridge/`) → Redis (streams + live hashes) → Node worker → PostgreSQL → Next.js API → dashboard UI
```

`src/worker-v2/` is the sole production Node worker. It owns history ingestion,
live state, equity/excursion sampling, account provisioning, and economic
events. `src/worker-v3/` remains inactive scaffolding.

`src/worker-v2/mt5-enums.ts` and `src/worker-v3/mt5-enums.ts` byte-identical twins (no cross-import possible between two worker trees) — any enum-decode change must land in both.

## Model inventory

Status legend: **live** = has both writer + reader today · **staged** = writer and/or reader not wired yet but referenced in active worker-v3 plan · **dead** = zero writer, zero reader anywhere in `src/`, `bridge/`, confirmed by grep, not referenced in any active plan.

| Model | Status | Producer | Consumer | Notes |
|---|---|---|---|---|
| `TradingAccount` | live | `bridge-accounts.ts` (`ensureBridgeAccounts`) | almost everything (`account-resolver.ts`, `preaggregated-cache.ts`, `account-data.ts`, live-sync) | Root entity. `brokerUtcOffsetMinutes` gates all time-based ingestion (CLAUDE.md "Broker offset"). `marginMode`/`tradeMode` carry MT5's accounting system (netting/hedging) + account type (demo/contest/real) — read from Redis live hash. |
| `AccountSnapshot` | live | `live-sync.ts` | `account-data.ts` | Latest balance/equity/margin/marginLevel — source of truth per source-boundary table below. |
| `OpenPosition` | live | `live-sync.ts` | read via `TradingAccount.openPositions` include (not direct `.findMany`) | Floating P/L, open exposure, open counts boundary. |
| `Position` | live | `position-reconstructor.ts`, `history-consumer.ts` | `trade-history.ts`, `calculate-report-results.ts`, `account-data.ts` | Win rate / profit factor / Sharpe / averaged-metrics / MAE-MFE boundary (closed trades only). `mae`/`mfe` feed correlation metrics below. |
| `Deal` | live | `history-consumer.ts` | `calculate-report-results.ts`, `position-reconstructor.ts` | Balance curve / growth / drawdown / AHPR-GHPR / LR-correlation boundary. `direction` carries MT5's `DEAL_ENTRY` (in/out/inout/out_by) under shorter field name. |
| `EquitySnapshot` | live | `equity-sampler.ts` | `equity-curve.ts`, `preaggregated-cache.ts` | Intraday equity/margin, 60s cadence, feeds 1D sparkline. 7-day retention. Supersedes `EquityState` (see Technical Debt). |
| `PositionExcursion` | live | `equity-sampler.ts` | `position-excursion.ts` | Per-position P/L excursion samples alongside equity snapshots. |
| `Order` | live | `history-consumer.ts` | read via `TradingAccount.orders` include, feeds position reconstruction | `state` decoded to MT5 `ORDER_STATE` name (not raw numeric code); `fillPolicy`/`orderTimeType` carry MT5's `type_filling`/`type_time`. |
| `AccountReportResult` | live, cache-only | `calculate-report-results.ts` | `preaggregated-cache.ts` (`getAccountVersionProbe`) — **only** for its `computedAt`/`sourceReportDate` timestamps | **Not authoritative source.** UI's displayed metrics recomputed live per request in `preaggregated-cache.ts` from `Position`/`Deal` using same `analytics.ts` helpers. Writing column here alone never reaches UI — every metric must wire into both paths (see Derived Analytics Metrics). |
| `BridgeHistoryCheckpoint` / `BridgeHistoryChunk` / `BridgeHistoryRecord` | **retired, unused by live consumer** | `history-checkpoint.ts` (only via `scripts/reset-history.ts`) | none | Legacy bridge_v2 checkpoint model. The native bridge (`bridge/`) now owns backfill/coverage state in its own SQLite journal; nothing in the live consumption path writes to these tables. `history-checkpoint.ts` and `reset-history.ts` kept as a manual recovery tool only — no native-bridge replacement yet. |
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

`AccountReportResult` precomputed cache over above, never independent source.

## Order & account semantics (MT5 enum decoding)

MT5 order/account records carry several fields as raw numeric enum codes. Redis/bridge layer preserves raw values; Node worker decodes to named strings at mapping step, following existing pattern in `mt5-enums.ts` (`decodeDealType`, `decodeDealEntry`, `decodePositionSide`).

| Field | MT5 enum | Decoded values |
|---|---|---|
| `Order.state` | `ORDER_STATE` | `started` / `placed` / `partial` / `filled` / `canceled` / `rejected` / `expired` / `request_add` / `request_modify` / `request_cancel` |
| `Order.fillPolicy` | `ORDER_TYPE_FILLING` | `fok` / `ioc` / `return` / `boc` |
| `Order.orderTimeType` | `ORDER_TYPE_TIME` | `gtc` / `day` / `specified` / `specified_day` |
| `TradingAccount.marginMode` | `ACCOUNT_MARGIN_MODE` | `retail_netting` / `exchange` / `retail_hedging` |
| `TradingAccount.tradeMode` | `ACCOUNT_TRADE_MODE` | `demo` / `contest` / `real` |

`TradingAccount.marginMode`/`tradeMode` sourced from Redis live hash (`bridge/live.py` publishes `margin_mode`/`trade_mode` in each live snapshot, `mt5:account:{login}:live`) rather than historical stream — reflect account's current accounting mode as of last live sync.

**Not implemented:** MT5 execution mode (`SYMBOL_TRADE_EXECMODE` — Instant/Request/Market/Exchange) symbol/account property Python bridge doesn't query anywhere — persisting needs new bridge-side polling, not just mapping change.

## Derived analytics metrics

`src/lib/trading/analytics.ts` (plus `trade-distributions.ts` for regression/correlation pieces) computes set of MT5-report-style performance metrics. Every metric implemented exactly once, called from **both** cache-write path (`calculate-report-results.ts` → `AccountReportResult`) and live per-request path (`preaggregated-cache.ts` → API response) — dual call site mandatory, not incidental, since `AccountReportResult` cache-only (see Model Inventory).

| Metric | Definition | Range / scale |
|---|---|---|
| AHPR (Arithmetic Holding-Period Return) | Arithmetic mean of per-trade returns, from Deal-derived balance curve, trading events only | percent number (e.g. `2.34`), matching `winPercent`/`balanceDrawdown*Pct` convention |
| GHPR (Geometric Holding-Period Return) | See below | percent number |
| Z-Score | Runs-test statistic on win/loss sequence — see below | ≈ [-3, 3] |
| LR Correlation | Pearson correlation between balance curve + own least-squares regression line | [-1, 1] |
| LR Standard Error | Residual standard error of balance curve against that regression line | ≥ 0, same units as balance |
| Correlation(Profit, MFE) | Pearson correlation between closed-trade net P/L + Maximum Favorable Excursion | [-1, 1] |
| Correlation(Profit, MAE) | Pearson correlation between closed-trade net P/L + Maximum Adverse Excursion | [-1, 1] |
| Correlation(MFE, MAE) | Pearson correlation between MFE + MAE | [-1, 1] |
| Min / Max / Avg holding time | Position open-to-close duration, unified on `computeHoldingSeconds` | seconds |

All Pearson correlations above derived from same `computeLinearRegression` fit (already computed for MFE/MAE scatter panel): `r = sign(slope) · √(R²)`.

### GHPR

For sequence of *n* per-trade returns *r₁, r₂, …, rₙ*:

```
        ┌   n         ┐ 1/n
GHPR  = │  ∏  (1 + rᵢ) │      −  1
        └  i=1        ┘
```

i.e. geometric mean of per-trade growth factors, expressed as return.

### Z-Score

Runs test for win/loss-sequence non-randomness (Ralph Vince / MT5 strategy-tester formula):

**Variables**
- *N* — total trades
- *W* — winning trades (MT5 convention: break-even trade, net P/L = 0, counts as win, unlike Ralph Vince's original method which counts as loss)
- *L* — losing trades, *N = W + L*
- *R* — number of runs (run = maximal streak of consecutive trades on same side of win/loss line)
- *P = 2WL*

**Formula**

```
      N(R − 0.5) − P
Z = ────────────────────
     √( P(P − N) / (N − 1) )
```

Value near `0` → win/loss sequence statistically indistinguishable from random; `|Z| ≥ 3` → strong sequential dependence between consecutive trade outcomes.

## MT5 Report Coverage Matrix

Traceability matrix against `docs/Analytics Report & Metrics.md` (MetaTrader 5 report/metrics reference). Built from grep audit of `src/lib/trading/`, `src/components/trading-monitor/`, `prisma/schema.prisma` — not narrated. Status legend: **implemented** = computed + rendered in dashboard · **computed, not surfaced** = value exists in server-side function/API payload but no `.tsx` component renders it · **not built** = no code path exists · **N/A** = Strategy Tester–only concept, doesn't apply to live-account dashboard.

### §1 Report tabs & graphs

| Report item | Dashboard equivalent | Status | Notes |
|---|---|---|---|
| Summary tab | KPI chips (`metric-registry.ts` — gain/dd/pips/trades/opens/deposit/withdrawal) + `BotPnLPanel.tsx` balance curve | implemented | |
| Profit/Loss tab | `summarizeTrades`/`summarizeClosedPositions` (`analytics.ts:1476,976`) for gross profit/loss/profit factor; `computeAlgoTradingPercent` (`analytics.ts:831`) for manual-vs-algo split | partial | MT5's 3-way manual/algo/copy split is 2-way here (manual vs algo, comment-heuristic based); no month/year pivot table in UI, current-timeframe scalars only |
| Long/Short tab | `getLongTradeWinPercent`/`getShortTradeWinPercent` (`analytics.ts:1122,1143`) for win-rate-by-direction; `longTradesTotal`/`shortTradesTotal` count bar in `PerformanceBars.tsx:657` | split | Trade-count ratio rendered; win-rate-by-direction computed (`preaggregated-cache.ts`, `account-data.ts`) but no component consumes it |
| Symbols tab | `bySymbol`/`openBySymbol` (`preaggregated-cache.ts:1357-1423`, `types.ts`) | computed, not surfaced | Typed + computed server-side; zero `.tsx` consumer found |
| Risks tab | `PerformanceBars.tsx` (Sharpe/Profit Factor/Recovery Factor gauges) + `PerformanceRadar.tsx` (max-drawdown score) + `max-deposit-load` KPI chip | implemented | |
| Drawdown graph | `DrawdownPanel.tsx` — balance + equity drawdown curves overlaid on balance chart | implemented | Falls back to balance-derived drawdown when `EquitySnapshot`'s 7-day retention window empty (`DrawdownPanel.tsx:40-45`) |
| Deposit Load graph | — | not built | `computeDepositLoadPercent` (`analytics.ts:1214`) only feeds scalar KPI chip + `maximalDepositLoad` cache field (`preaggregated-cache.ts:905`); no time-series chart exists |

### §2 Trade history structures (field-level)

Traceable against full native MT5 API property set (`ENUM_DEAL_PROPERTY_*`/`ENUM_ORDER_PROPERTY_*`/`ENUM_POSITION_PROPERTY_*`, see `docs/mql5book-deal-properties.md`, `docs/mql5book-order-properties.md`, `docs/mql5book-position-properties.md`) — deeper audit than report-tab traceability in §1/§3, which only covers what terminal report page renders, not every property API exposes.

| Record | Prisma model | Coverage |
|---|---|---|
| Orders | `Order` (`schema.prisma:346-375`) | symbol, type, `orderTicket`(#), volume, `priceOpen`/`priceCurrent`/`priceStoplimit`(Price), state, sl/tp, `timeSetup`/`timeDone`/`timeExpiration`(Time), `magic`, `reason` (decoded via `decodeOrderReason`), comment. `fillPolicy`/`orderTimeType` decoded per enum table above. Consciously not persisted: `ORDER_VOLUME_INITIAL` vs `ORDER_VOLUME_CURRENT` (collapsed to one `volume` — `mappers.ts` prefers current; two only diverge mid-partial-fill, nothing surfaces that split today), `ORDER_POSITION_BY_ID` (close-by opposite position — netting-only, no consumer), `ORDER_EXTERNAL_ID` (exchange-side id, not applicable to FX/CFD broker). |
| Deals | `Deal` (`schema.prisma:190-222`) | direction(in/out/inout), volume, price, profit, fee, swap, commission, comment, `balance`(balanceAfter), `magic`, `reason` (decoded via `decodeDealReason`). MT5's Δ (open/close price delta) isn't stored column, derivable from linked deal pairs but not materialized. Balance/funding rows identified via `isBalanceDeal`/`isFundingDeal` (`analytics.ts:397,405`). Consciously not persisted: `DEAL_SL`/`DEAL_TP` (position-level sl/tp on `Position`/`OpenPosition` is useful surface; deal-level snapshot redundant), `DEAL_EXTERNAL_ID`, `DEAL_TIME_MSC` (Postgres `timestamp` already carries sub-second precision). |
| Positions | `Position` (`schema.prisma:157-190`) | open/close time, volume, `openPrice`/`closePrice`, profit, swap, commission, pips, mae/mfe, `magic`, `reason`. `OpenPosition` (`schema.prisma:131-156`) additionally has live sl/tp/marketPrice; `magic` already flowed through `mapPositionToOpenPosition`, `reason` (`POSITION_REASON`) does not yet — it's on wire (`bridge/live.py`'s `_LIVE_POSITION_FIELDS`) but `mapPositionToOpenPosition` doesn't read it, no `OpenPosition.reason` column exists (open gap, not part of this pass). For **closed** positions, `magic`/`reason` reconstructed in `position-reconstructor.ts` from deals that built position — `magic` = first deal carrying one (stable per EA/order chain), `reason` = last state-changing deal's reason (i.e. closing deal's `DEAL_REASON` — closest available proxy for "why did this position close", since MT5 doesn't expose `POSITION_REASON` after position gone). `POSITION_TIME_UPDATE` (volume-change time) isn't in live payload at all — needs a `bridge/` live-publisher change (same-host deploy via `nssm restart bridge` — see `.claude/skills/ssh-vps/references/deploy.md`), out of scope here. MT5's "weighted average price" framing assumes partial-fill aggregation, happens upstream in `position-reconstructor.ts`, not recomputed at read time. |

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
| Entries by Hours/Weekdays/Months (session color-coded) | not built | `ProfitHeatmapPanel.tsx` is GitHub-style daily-P/L calendar (day × week-of-year) — different diagram, not hour/weekday entry histogram. No Asian/European/American session color-coding exists anywhere in codebase. |
| Profits/Losses by Hours/Weekdays/Months | not built | Same gap as above |
| MFE-Profits Distribution | implemented | `TradeDistributionPanel.tsx` mode `"mfe-profit"` |
| MAE-Profits Distribution | implemented | `TradeDistributionPanel.tsx` mode `"mae-profit"` |
| Profit vs Holding-Time Distribution | implemented | `TradeDistributionPanel.tsx` mode `"profit-time"`, `formatHoldingDuration` (`trade-distribution-chart.ts:180`) |

### §5 Five key metrics + thresholds

All five gauged, spread across three components rather than one panel:

| Metric | Component | Zone thresholds vs MT5 spec |
|---|---|---|
| Sharpe Ratio | `PerformanceBars.tsx` (`SHARPE_ZONES`) | House-tuned: poor ≤0.5 / fair ≤2.0 / good ≤3.0 / great ≤5.0 — code comment states these "benchmark thresholds tuned for retail FX accounts," not literal port of spec's <0/<1.0/≥1.0/≥3.0 bands |
| Maximum Drawdown | `PerformanceRadar.tsx` (inverted score, `maxDrawdownPct`) | Spec target <20-30%; radar zone constants not verified this pass |
| Recovery Factor | `PerformanceBars.tsx` (`RECOVERY_ZONES`) | poor ≤1 / fair ≤3 / good ≤5 / great ≤7 — aligns with spec's ">3 ideal" at fair/good boundary |
| Profit Factor | `PerformanceBars.tsx` (`PROFIT_FACTOR_ZONES`) | poor ≤1.0 / fair ≤1.5 / good ≤2.5 / great ≤4.0 — matches spec's break-even-at-1.0 threshold exactly |
| Maximum Deposit Load | `max-deposit-load` KPI chip (`metric-registry.ts:86`) | Scalar display only, no zone/threshold coloring |

## Technical Debt & Pending Migrations

### Priority: delete 4 dead models

Confirmed via grep across `src/`, `bridge/`, `scripts/` — zero `prisma.<model>.{create,upsert,update,delete,findMany,findFirst,findUnique,count,aggregate}` calls anywhere, no reference in any active worker-v3 plan (which would instead mark model "staged"). Each superseded by model that *is* live. **Leaving these in schema risks accidental reuse** — future change could read/write one thinking it's current source, silently producing data nothing consumes.

| Model | Why it's dead | Superseded by |
|---|---|---|
| `Symbol` | Never wired up. No writer ever existed. | — |
| `EquityState` | Early design intended this as equity/drawdown source. Also uses raw `snake_case` field names with no `@map`/`@@map`, breaking this schema's naming convention. | `EquitySnapshot` |
| `PositionState` | Early design intended this as MAE/MFE source. Its relation to `OpenPosition` (`[account_number, position_id]` → `[tradingAccountId, positionNo]`) requires `account_number` to hold `TradingAccount.id` (cuid) despite every other model using that field name for broker account number — footgun if anyone ever revives it as-is. | `Position.mae`/`Position.mfe` + `PositionExcursion` |
| `RiskMetricsSnapshot` | Never wired up on either side. | — |

Deletion plan (Phase 1 of `docs/superpowers/plans/2026-07-18-mt5-schema-and-analytics-metrics-plan.md`): drop 4 models plus back-relations on `TradingAccount`/`OpenPosition`. Low risk — nullable-add-only pattern doesn't apply here, but zero writers, so no in-flight data loss possible.

Phases 2/4/5 of same plan also complete (2026-07-22): `groupBy=symbol|strategy` API branch had zero frontend callers, so `ClosedPosition`, `AccountPerformanceBySymbol`/`AccountPerformanceByStrategy`, `Strategy` (its only consumer was that same branch), and `aggregate-performance.ts` all dropped rather than migrated forward. `Position` now sole closed-trade source, confirmed via real-data parity check (21,378 rows, 4 accounts, 100% match) before drop.

### Other pending migrations

- **MT5 execution mode** — not persisted; blocked on new bridge-side polling (see Order & Account Semantics above).
- **UI gauge display for derived analytics metrics above** — not built. Z-Score and LR Correlation bidirectional ("good = near zero", not "higher is better") and don't fit existing `PerformanceBars.tsx` ascending-zone gauge shape; new zone thresholds design decision, not to guess at.
- **Long/Short win-rate and Symbols-tab UI** — `getLongTradeWinPercent`/`getShortTradeWinPercent` and `bySymbol`/`openBySymbol` computed + typed end-to-end but zero UI consumer (see MT5 Report Coverage Matrix §1). Only trade *count* by direction rendered today.
- **Deposit Load time-series graph** — `computeDepositLoadPercent` only backs scalar KPI chip; no chart plots it over time the way `DrawdownPanel.tsx` does for drawdown.
- **Entries/Profits-by-Hour-Weekday-Month diagrams with session color-coding** — not built anywhere; `ProfitHeatmapPanel.tsx` different diagram (daily P/L calendar, not entry-time histogram).
