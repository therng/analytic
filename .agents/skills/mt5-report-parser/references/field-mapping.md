# MT5 HTML Template → Standardized JSON Field Mapping

All placeholder names use MT5's `<!--NAME-->` syntax. JSON keys use snake_case.

---

## Template Technical Structure

### MQTABLE Section Markers

MT5 wraps each data section in `<!--MQTABLE=NAME-->` ... `<!--MQTABLE-->` comment pairs. These are **not visible in the rendered HTML** — they are consumed by MT5's template engine at export time. The exported HTML contains only the rendered rows without these markers.

| MQTABLE Identifier | Section |
|---|---|
| `TRADE_POSITIONS_HST` | Closed positions (historical) |
| `TRADE_ORDERS_HST` | Historical orders |
| `TRADE_DEALS_HST` | Deals ledger |
| `TRADE_POSITIONS_HEADER` | Open positions header row |
| `TRADE_POSITIONS` | Open positions data rows |
| `TRADE_POSITIONS_FOOTER` | Open positions totals footer |
| `TRADE_ORDERS_HEADER` | Working orders header row |
| `TRADE_ORDERS` | Working orders data rows |

**Parser implication:** After export, section boundaries must be detected from section header `<th>` rows (containing `<!--REPORT_POSITIONS_STR-->` etc.) or by scanning preceding sibling elements — the MQTABLE markers no longer exist.

### Hidden Cell Mechanism

MT5 uses CSS class `"hidden"` and inline `display:none` to conditionally hide cells. Two key cases:

1. **`<!--POSITION_COMMENT_CLASS-->`** — set to `"hidden"` when a position row has no comment. When visible, the comment `<td>` has `colspan="8"` and shifts all financial columns rightward.
2. **`<!--DEAL_COST_CLASS-->`** — the cost/fee column is hidden for deal types that don't use it.
3. **`<!--POSITION_PROFIT_COLSPAN-->`** and **`<!--ORDER_STATE_COLSPAN-->`** — dynamic colspans that change table layout.

**Parser must filter:** skip any `<td>`/`<th>` where `class` contains `hidden` OR `style` contains `display:none` before building the header map or extracting cell values.

### Balance Graph Placeholder

`<!--REPORT_BALANCE_GRAPH-->` embeds a balance chart image directly in the HTML (as an `<img>` tag or base64 data). The parser should skip this cell — it is not text data.

---

## Header / Metadata

| HTML Placeholder | JSON Path | Type | Notes |
|---|---|---|---|
| `<!--ACCOUNT-->` | `meta.account_number` | string | Numeric digits only; also appears in `<title>` |
| `<!--NAME-->` | `meta.owner_name` | string | Account holder name |
| `<!--COMPANY-->` | `meta.company` | string | Broker company name |
| `<!--CURRENCY-->` | `meta.currency` | string | e.g. "USD" |
| `<!--SERVER-->` | `meta.server` | string | Broker server name |
| `<!--DATE-->` | `meta.report_timestamp` | ISO-8601 | Bangkok time (+07:00) |
| `<!--ACCOUNT_TYPE-->` | `meta.account_type` | string | "Real" / "Demo" |
| `<!--ACCOUNT_MARGIN_TYPE-->` | `meta.margin_type` | string | "Hedging" / "Netting" |

---

## Positions Table (closed trades)

| HTML Placeholder | JSON Key | Type | Notes |
|---|---|---|---|
| `<!--POSITION_TIME-->` | `open_time` | ISO-8601 | Position open timestamp |
| `<!--POSITION_POSITION-->` | `position_no` | string | Unique ID per account |
| `<!--POSITION_SYMBOL-->` | `symbol` | string | e.g. "EURUSD" |
| `<!--POSITION_TYPE-->` | `type` | string | "buy" / "sell" |
| `<!--POSITION_VOLUME-->` | `volume` | float | Lot size |
| `<!--POSITION_PRICE-->` | `open_price` | float | Entry price |
| `<!--POSITION_SL-->` | `sl` | float\|null | Stop loss; null if not set |
| `<!--POSITION_TP-->` | `tp` | float\|null | Take profit; null if not set |
| `<!--POSITION_TIME_CLOSE-->` | `close_time` | ISO-8601 | Position close timestamp |
| `<!--POSITION_PRICE_CLOSE-->` | `close_price` | float | Exit price |
| `<!--POSITION_COMMISSION-->` | `commission` | float | Negative value |
| `<!--POSITION_SWAP-->` | `swap` | float | Overnight interest; negative if charged |
| `<!--POSITION_PROFIT-->` | `profit` | float | Raw MT5 profit (excludes swap/commission) |
| `<!--POSITION_COMMENT-->` | `comment` | string\|null | EA comment or manual tag |

**Derived field (not in HTML):**
```
net_pnl = profit + swap + commission
```

---

## Orders Table (historical orders — informational only)

| HTML Placeholder | JSON Key | Type |
|---|---|---|
| `<!--ORDER_OPEN_TIME-->` | `open_time` | ISO-8601 |
| `<!--ORDER_ORDER-->` | `order_id` | string |
| `<!--ORDER_SYMBOL-->` | `symbol` | string |
| `<!--ORDER_TYPE-->` | `type` | string |
| `<!--ORDER_VOLUME-->` | `volume` | float |
| `<!--ORDER_PRICE-->` | `price` | float |
| `<!--ORDER_SL-->` | `sl` | float\|null |
| `<!--ORDER_TP-->` | `tp` | float\|null |
| `<!--ORDER_TIME-->` | `close_time` | ISO-8601 |
| `<!--ORDER_STATE-->` | `state` | string |
| `<!--ORDER_COMMENT-->` | `comment` | string\|null |

---

## Deals Table (full ledger including balance operations)

| HTML Placeholder | JSON Key | Type | Notes |
|---|---|---|---|
| `<!--DEAL_TIME-->` | `time` | ISO-8601 | Execution timestamp |
| `<!--DEAL_DEAL-->` | `deal_id` | string | Unique ledger entry ID |
| `<!--DEAL_SYMBOL-->` | `symbol` | string\|null | Blank for balance ops |
| `<!--DEAL_TYPE-->` | `type` | string | "buy"/"sell"/"balance"/"credit" |
| `<!--DEAL_DIRECTION-->` | `direction` | string\|null | "in"/"out"; null for balance ops |
| `<!--DEAL_VOLUME-->` | `volume` | float | 0 for balance ops |
| `<!--DEAL_PRICE-->` | `price` | float\|null | Execution price |
| `<!--DEAL_ORDER-->` | `order_id` | string\|null | Linked order |
| `<!--DEAL_COMMISSION-->` | `commission` | float | Negative value |
| `<!--DEAL_FEE-->` | `fee` | float | Additional fee (e.g. funding fee) |
| `<!--DEAL_STORAGE-->` | `swap` | float | Overnight interest (storage) |
| `<!--DEAL_PROFIT-->` | `profit` | float | P/L for this deal |
| `<!--DEAL_BALANCE-->` | `balance_after` | float\|null | Running account balance after deal |
| `<!--DEAL_COMMENT-->` | `comment` | string\|null | |

**Deal classification:**
```
trading_deal  → symbol is not null AND direction is not null
balance_deal  → type in ("balance", "credit")  — deposit, withdrawal, credit
```

---

## Open Positions Table

| HTML Placeholder | JSON Key | Type | Notes |
|---|---|---|---|
| `<!--POSITION_TIME-->` | `open_time` | ISO-8601 | When position was opened |
| `<!--POSITION_POSITION-->` | `position_id` | string | |
| `<!--POSITION_SYMBOL-->` | `symbol` | string | |
| `<!--POSITION_TYPE-->` | `type` | string | "buy" / "sell" |
| `<!--POSITION_VOLUME-->` | `volume` | float | |
| `<!--POSITION_PRICE-->` | `open_price` | float | |
| `<!--POSITION_SL-->` | `sl` | float\|null | |
| `<!--POSITION_TP-->` | `tp` | float\|null | |
| `<!--POSITION_PRICE_CURRENT-->` | `market_price` | float | Current market price |
| `<!--POSITION_SWAP-->` | `swap` | float | |
| `<!--POSITION_PROFIT-->` | `floating_profit` | float | Current unrealized P/L |
| `<!--POSITION_COMMENT-->` | `comment` | string\|null | |

---

## Working Orders Table

| HTML Placeholder | JSON Key | Type | Notes |
|---|---|---|---|
| `<!--ORDER_OPEN_TIME-->` | `open_time` | ISO-8601 | Order placement time |
| `<!--ORDER_ORDER-->` | `order_id` | string | |
| `<!--ORDER_SYMBOL-->` | `symbol` | string | |
| `<!--ORDER_TYPE-->` | `type` | string | "buy_limit", "sell_stop", etc. |
| `<!--ORDER_VOLUME-->` | `volume_requested` | float | |
| `<!--ORDER_PRICE-->` | `price` | float | Trigger price |
| `<!--ORDER_SL-->` | `sl` | float\|null | |
| `<!--ORDER_TP-->` | `tp` | float\|null | |
| `<!--ORDER_PRICE_CURRENT-->` | `market_price` | float | |
| `<!--ORDER_STATE-->` | `state` | string | "Working" / "Partial" |
| `<!--ORDER_COMMENT-->` | `comment` | string\|null | |

---

## Summary Block (label:value pairs)

| Label in HTML | JSON Path | Type | Official Definition |
|---|---|---|---|
| Deposit/Withdrawal | `summary.deposit_withdrawal` | float | Net total of deposits and withdrawals |
| Credit Facility | `summary.credit_facility` | float | Credit funds on the account |
| Closed Trade P/L | `summary.closed_trade_pl` | float | Total profit/loss of all closed trades |
| Floating P/L | `summary.floating_pl` | float | Current profit/loss of all open positions |
| Balance | `summary.balance` | float | Balance **not including** open position results |
| Equity | `summary.equity` | float | Balance **including** open position results |
| Margin | `summary.margin` | float | Funds required to maintain open positions |
| Free Margin | `summary.free_margin` | float | Account's free margin |
| Margin Level | `summary.margin_level` | float\|null | Equity / Margin × 100 (%) |

---

## Details Block (label:value pairs — performance metrics)

> **How MT5 classifies deals for Gross Profit/Loss:**
> For each deal: `result = profit - commission - fees - swap`
> If `result > 0` → counted in Gross Profit. If `result < 0` → counted in Gross Loss.
> (In the project's DB, commission/swap are stored as negative values, so the equivalent is `profit + swap + commission + fee`)

| Label in HTML | JSON Path | Type | Official Definition |
|---|---|---|---|
| Total Net Profit | `metrics.total_net_profit` | float | Financial result of all trades |
| Gross Profit | `metrics.gross_profit` | float | Sum of all profitable deals (result > 0) |
| Gross Loss | `metrics.gross_loss` | float | Sum of all losing deals (result < 0); stored negative |
| Profit Factor | `metrics.profit_factor` | float | Ratio of Gross Profit to Gross Loss; 1.0 = equal |
| Expected Payoff | `metrics.expected_payoff` | float | `Total Net Profit / Total Trades`; expected return of next deal |
| Recovery Factor | `metrics.recovery_factor` | float | `abs(Total Net Profit) / Maximum Drawdown` |
| Sharpe Ratio | `metrics.sharpe_ratio` | float | Mean profit / std dev, per holding period, risk-free adjusted |
| Balance Drawdown Absolute | `metrics.drawdown.absolute` | float | `InitialDeposit − MinimalBalance` (below initial only) |
| Balance Drawdown Maximal | `metrics.drawdown.maximal_amount` | float | `max(LocalHigh − NextLocalLow)` in currency |
| Balance Drawdown Maximal (%) | `metrics.drawdown.maximal_pct` | float | Same peak-to-trough as percentage; shown in parens |
| Balance Drawdown Relative (%) | `metrics.drawdown.relative_pct` | float | `max((LocalHigh−NextLocalLow)/LocalHigh×100)` — primary value |
| Balance Drawdown Relative | `metrics.drawdown.relative_amount` | float | Currency amount of relative DD peak-to-trough; shown in parens |
| Total Trades | `metrics.total_trades` | int | Trading deals that resulted in profit or loss (excludes balance ops) |
| Short Trades (won %) | `metrics.win_stats.short_total` + `short_won` | int | Sell trades total + won; `"45 (62.22%)"` → total=45, won=28 |
| Long Trades (won %) | `metrics.win_stats.long_total` + `long_won` | int | Buy trades total + won; same format |
| Profit Trades (% of total) | `metrics.win_stats.profit_trades` | int | Profitable trade count; % in parens (display only) |
| Loss Trades (% of total) | `metrics.win_stats.loss_trades` | int | Losing trade count; % in parens (display only) |
| Largest Profit Trade | `metrics.win_stats.largest_profit_trade` | float | Largest single profitable deal |
| Largest Loss Trade | `metrics.win_stats.largest_loss_trade` | float | Largest single losing deal; negative |
| Average Profit Trade | `metrics.win_stats.average_profit_trade` | float | Total profits / count of winning trades |
| Average Loss Trade | `metrics.win_stats.average_loss_trade` | float | Total losses / count of losing trades; negative |
| Maximum Consecutive Wins ($) | `metrics.win_stats.max_consecutive_wins_count` + `_amount` | int/float | Longest win streak + total profit; `"8 ($450.00)"` — count first |
| Maximum Consecutive Losses ($) | `metrics.win_stats.max_consecutive_losses_count` + `_amount` | int/float | Longest loss streak + total loss; `"5 ($-280.00)"` — count first |
| Maximal Consecutive Profit (count) | `metrics.win_stats.maximal_consecutive_profit_amount` + `_count` | float/int | Highest profit from a streak + trade count; `"$650.00 (7)"` — amount first |
| Maximal Consecutive Loss (count) | `metrics.win_stats.maximal_consecutive_loss_amount` + `_count` | float/int | Highest loss from a streak + trade count; `"$-420.00 (4)"` — amount first |
| Average Consecutive Wins | `metrics.win_stats.average_consecutive_wins` | float | Average number of wins in profitable series |
| Average Consecutive Losses | `metrics.win_stats.average_consecutive_losses` | float | Average number of losses in losing series |

### Exact Template Placeholder Names → JSON Path (Stats Section)

The `_STR` variants are localized label strings (vary by platform language). The data placeholders are fixed:

| Template Placeholder (fixed) | JSON Path |
|---|---|
| `<!--REPORT_NETPROFIT-->` | `metrics.total_net_profit` |
| `<!--REPORT_GROSSPROFIT-->` | `metrics.gross_profit` |
| `<!--REPORT_GROSSLOSS-->` | `metrics.gross_loss` |
| `<!--REPORT_PROFITFACTOR-->` | `metrics.profit_factor` |
| `<!--REPORT_EXPECTEDPAYOFF-->` | `metrics.expected_payoff` |
| `<!--REPORT_RECOVERYFACTOR-->` | `metrics.recovery_factor` |
| `<!--REPORT_SHARPERATIO-->` | `metrics.sharpe_ratio` |
| `<!--REPORT_BDDABSOLUTE-->` | `metrics.drawdown.absolute` |
| `<!--REPORT_BDDMAXIMAL-->` | `metrics.drawdown.maximal_amount` + `.maximal_pct` |
| `<!--REPORT_BDDRELATIVE-->` | `metrics.drawdown.relative_pct` + `.relative_amount` |
| `<!--REPORT_TRADES-->` | `metrics.total_trades` |
| `<!--REPORT_SHORTPOSITIONS-->` | `metrics.win_stats.short_total` + `short_won` |
| `<!--REPORT_LONGPOSITIONS-->` | `metrics.win_stats.long_total` + `long_won` |
| `<!--REPORT_PROFITTRADES-->` | `metrics.win_stats.profit_trades` |
| `<!--REPORT_LOSSTRADES-->` | `metrics.win_stats.loss_trades` |
| `<!--REPORT_LARGEST_PROFITTRADES-->` | `metrics.win_stats.largest_profit_trade` |
| `<!--REPORT_LARGEST_LOSSTRADES-->` | `metrics.win_stats.largest_loss_trade` |
| `<!--REPORT_AVERAGE_PROFITTRADES-->` | `metrics.win_stats.average_profit_trade` |
| `<!--REPORT_AVERAGE_LOSSTRADES-->` | `metrics.win_stats.average_loss_trade` |
| `<!--REPORT_MAXIMUM_CONSECUTIVEWINSM-->` | `metrics.win_stats.max_consecutive_wins_count` + `_amount` |
| `<!--REPORT_MAXIMUM_CONSECUTIVELOSSESM-->` | `metrics.win_stats.max_consecutive_losses_count` + `_amount` |
| `<!--REPORT_MAXIMAL_CONSECUTIVEPROFIT-->` | `metrics.win_stats.maximal_consecutive_profit_amount` + `_count` |
| `<!--REPORT_MAXIMAL_CONSECUTIVELOSS-->` | `metrics.win_stats.maximal_consecutive_loss_amount` + `_count` |
| `<!--REPORT_AVERAGE_CONSECUTIVEWINS-->` | `metrics.win_stats.average_consecutive_wins` |
| `<!--REPORT_AVERAGE_CONSECUTIVELOSSES-->` | `metrics.win_stats.average_consecutive_losses` |
| `<!--REPORT_BALANCE_GRAPH-->` | *(embedded chart image — skip in parser)* |

**Summary section standalone placeholders:**

| Template Placeholder | JSON Path |
|---|---|
| `<!--BALANCE-->` | `summary.balance` |
| `<!--CREDIT_FACILITY-->` | `summary.credit_facility` |
| `<!--FREE_MARGIN-->` | `summary.free_margin` |
| `<!--MARGIN-->` | `summary.margin` |
| `<!--FLOATING_PL-->` | `summary.floating_pl` |
| `<!--EQUITY-->` | `summary.equity` |

### Critical parsing note — Drawdown cell formats

```
"Balance Drawdown Maximal" cell value: "800.00 (8.50%)"
  → maximal_amount = 800.00
  → maximal_pct = 8.50

"Balance Drawdown Relative" cell value: "12.30% (650.00)"
  → relative_pct = 12.30
  → relative_amount = 650.00
```

These formats are **reversed** — Maximal leads with amount, Relative leads with percentage.
