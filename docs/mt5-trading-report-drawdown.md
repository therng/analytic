# Trading Report

> Source: [MetaTrader 5 Help — Trading Report](https://www.metatrader5.com/en/terminal/help/trading_advanced/history_report)  
> Section: [Drawdown Calculation Example](https://www.metatrader5.com/en/terminal/help/trading_advanced/history_report#drawdown)  
> Extracted: 2026-07-19

Platform auto-save + publish account statement [reports](https://www.metatrader5.com/en/terminal/help/startworking/settings#ftp). Save report: select "Report" in context menu of [History](https://www.metatrader5.com/en/terminal/help/trading/performing_deals#trade_history) tab.

HTML reports generated from template `ReportHistory.htm`, in [/Templates](https://www.metatrader5.com/en/terminal/help/start_advanced/structure#templates) folder.

Report divided into blocks:

---

## Header

Contains:

- Brokerage company name
- Account number
- Account owner name
- Deposit currency
- Report generation date

---

## Orders

Table of all [orders](https://www.metatrader5.com/en/terminal/help/trading/performing_deals#trade_history) from account history. Same info fields as corresponding tab.

---

## Deals

All [trades](https://www.metatrader5.com/en/terminal/help/trading/performing_deals#trade_history) ever executed on account. Same info fields as corresponding tab. Extra param at bottom:

- **Recorder profit/loss (Closed P/L)** — total profit/loss all trades.

---

## Positions

All [open positions](https://www.metatrader5.com/en/terminal/help/trading/performing_deals#position_list) on account. Same info fields as "Trade" tab. Extra param at bottom:

- **Floating profit/loss (Floating P/L)** — current profit/loss all open positions.

---

## Working Orders

All active orders ([pending orders](https://www.metatrader5.com/en/terminal/help/trading/performing_deals#pending) + unfilled market orders). Same info fields as "Trade" tab.

---

## Summary

Account summary values:

- **Credit Facility** — credit funds info on account
- **Floating P/L** — current profit/loss all open positions
- **Balance** — account balance, excludes open position results
- **Equity** — account equity, includes open position results
- **Margin** — funds needed to hold open positions
- **Free Margin** — account free margin amount
- **Margin Level** — equity/margin ratio percent (`Equity / Margin * 100`)

---

## Details

Upper part: account balance graph from deals (X axis = deal count).

- **Gross Profit** — sum all profitable trades, money terms. Per deal: profit (loss) − commission − fees − swap. Result >0 = profitable, <0 = loss.
- **Gross Loss** — sum all losing trades, money terms
- **Total Net profit** — financial result all trades
- **Profit Factor** — gross profit / gross loss ratio, percent. 1 = equal
- **Expected Payoff** — statistical avg return per deal. Also expected return next trade
- **Balance Drawdown Absolute** — diff between initial deposit and lowest balance below it, across whole account history.

  ```
  AbsoluteDrawDown = InitialDeposit - MinimalBalance
  ```

- **Balance Drawdown Maximal** — difference in deposit currency between the highest local balance value and the next lowest account balance value. The maximal drawdown value in percentage is given in brackets.

  ```
  MaximumDrawDown = Max[Local High - Next Local Low]
  ```

- **Balance Drawdown Relative** — difference in percentage terms between the highest local balance value and the next lowest account balance value. The maximal drawdown value in monetary terms is given in brackets.

  ```
  RelativeDrawdown = Max[(Local High - Next Local Low) / Local High * 100]
  ```

- **Total trades** — the total amount of executed trades (the trades that resulted in a profit or loss)
- **Short Trades (won %)** — number of trades that resulted in profit obtained from selling a financial instrument, and percentage of profitable short trades
- **Long Trades (won %)** — number of trades that resulted in profit obtained from purchasing a financial instrument, and percentage of profitable long trades
- **Profit Trades (% of total)** — the amount of profitable trades and their percentage in the total trades
- **Loss trades (% of total)** — the amount of losing trades and their percentage in the total trades
- **Largest profit trade** — the largest profit of all profitable trades
- **Largest loss trade** — the largest loss of all loss-making trades
- **Average profit trade** — the average profit value per a trade (the total of profits divided by the number of winning trades)
- **Average loss trade** — the average loss value per a trade (the total of losses divided by the number of losing trades)
- **Maximum consecutive wins ($)** — the longest series of winning trades and their total profit
- **Maximum consecutive losses ($)** — the longest series of losing trades and their total loss
- **Maximal consecutive profit (count)** — the maximum profit of a series of profitable trades and the amount of profitable trades in this series
- **Maximal consecutive loss (count)** — the maximum loss of a series of losing trades and the amount of losing trades in this series
- **Average consecutive wins** — the average number of winning trades in profitable series
- **Average consecutive losses** — the average number of losing trades in losing series

---

## Drawdown Calculation Example

The below chart shows the Balance change curve. The **Initial Deposit is 5000**.

- The largest Balance drop below the Initial Deposit was at point three — **4000**.

  ```
  Absolute Drawdown = 5000 - 4000 = 1000
  ```

- The largest Balance drop in **percentage** terms was between points two and three.

  ```
  Relative Drawdown = (6000 - 4000) / 6000 * 100 = 33.3%
  ```

  This difference was equal to **2000** in monetary terms.

- The largest drop in **monetary** terms was between the last point and the previous one.

  ```
  Maximum Drawdown = 8000 - 5500 = 2500
  ```

  This difference was equal to **31.25%** in percentage terms.

### Summary of the three drawdown measures

| Metric | Formula | Example value |
| --- | --- | --- |
| **Absolute Drawdown** | `InitialDeposit − MinimalBalance` | `5000 − 4000 = 1000` |
| **Relative Drawdown** | `Max[(Local High − Next Local Low) / Local High × 100]` | `(6000 − 4000) / 6000 × 100 = 33.3%` (≈ 2000 money) |
| **Maximum Drawdown** | `Max[Local High − Next Local Low]` | `8000 − 5500 = 2500` (≈ 31.25%) |

> Official illustration:  
> <https://www.metatrader5.com/i/help/terminal/en/drawdown.png>