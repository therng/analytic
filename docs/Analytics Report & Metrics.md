# MetaTrader 5 Analytics Report & Metrics Guide
## 1. Trading Report Overview
Trading report show results visual, help evaluate performance, optimize portfolios, analyze stability vs risk.
**Report Tabs Breakdown**
* **Summary:** Overview trading over time. Profit/loss metrics, deposit/withdrawal amounts, balance, growth, dividends graphs.
* **Profit/Loss:** Profitable/losing trades, categorized by type (manual, algorithmic, copy trading). Analyze by trades or money, months or years.
* **Long/Short:** Buy vs Sell ratio at time periods, plus profitability each direction.
* **Symbols:** Trades by instrument — which symbols gain/lose, frequency, graphs of trade/money volumes.
* **Risks:** Key risk traits via drawdown and deposit load graphs, plus win/loss ratio.
**Drawdown & Deposit Load Graphs**
* **Drawdown graph:** Equity/balance drops, overlaid on balance change graph, shows capital degradation periods.
* **Deposit Load graph:** % account equity used as margin over time, mapped against balance graph, shows risk aggressiveness.

## 2. Trade History Structures
**A. Orders Record Data**
Parameters of placed trade requests.
1. **Symbol:** Financial instrument of order.
2. **Symbol:** Financial instrument of order.
3. **Type:** Order type (e.g., Buy, Sell, Sell Stop, Sell Limit, Buy Stop, Buy Limit, Buy Stop Limit, or Sell Stop Limit).
4. **Type:** Order type (e.g., Buy, Sell, Sell Stop, Sell Limit, Buy Stop, Buy Limit, Buy Stop Limit, or Sell Stop Limit).
5. **#:** Ticket number (unique ID) of trade operation.
6. **#:** Ticket number (unique ID) of trade operation.
7. **Volume:** Volume requested (lots or units).
8. **Volume:** Volume requested (lots or units).
9. **Price:** Price specified for execution.
10. **Price:** Price specified for execution.
11. **State:** Order result (e.g., Filled, Partially, Canceled).
12. **State:** Order result (e.g., Filled, Partially, Canceled).
13. **Time:** Time order placed (YYYY.MM.DD HH:MM).
14. **Time:** Time order placed (YYYY.MM.DD HH:MM).
15. **S/L:** Stop Loss level (red if closed by S/L).
16. **S/L:** Stop Loss level (red if closed by S/L).
17. **T/P:** Take Profit level (green if closed by T/P).
18. **T/P:** Take Profit level (green if closed by T/P).
19. **Comment:** Comment by trader or system (e.g., [sl price] or [tp price]).
20. **Comment:** Comment by trader or system (e.g., [sl price] or [tp price]).
21. **Comment:** Comment by trader or system (e.g., [sl price] or [tp price]).
22. **Comment:** Comment by trader or system (e.g., [sl price] or [tp price]).
23. **Comment:** Comment by trader or system (e.g., [sl price] or [tp price]).
24. **Comment:** Comment by trader or system (e.g., [sl price] or [tp price]).

**B. Deals Record Data**
Actual execution data of trade. Deals from Stop Loss red; from Take Profit green.
* **Summary Metrics:** Deposit (sum deposits/withdrawals), Profit (excl swaps/commissions), Swap, Commission, Balance.
* **Detailed Fields:** Direction (in, out, in/out), Volume, Price, Profit (zero for entry deals), \Delta (open/close price diff, points/percent, exit trades only), Order ticket number, Fee (separate broker fee), Comment.

**C. Positions Record Data**
Aggregated data, all deals for one market position (open, volume adds, partial closes, full close):
* Position open/close time (first and last trade).
* Position volume (current closed volume + source volume if partial).
* Weighted average open/close prices.
* Total financial result of position deals (excl swaps/commissions).

## 3. Testing Report Parameters
Performance metrics from Strategy Tester, automated execution eval:
* **History Quality:** % correct vs incorrect 1-minute data. Gaps or volume=1 bars w/ differing OHLC lower score.
* **Bars / Ticks / Symbols:** Count bars generated, ticks modeled, symbols requested during test.
* **Initial Deposit / Withdrawal:** Starting capital + total money withdrawn.
* **Total Net Profit:** Final result of all trades (Gross Profit - Gross Loss).
* **Gross Profit / Gross Loss:** Sum of all profitable trades / all losing trades.
* **Balance Drawdown Absolute:** Initial deposit minus minimal balance reached: \text{Absolute Drawdown} = \text{Initial Deposit} - \text{Minimal Balance}
* **Balance Drawdown Maximal:** Highest drop, local balance peak to next local low, in currency: \text{Maximal Drawdown} = \max(\text{Local High} - \text{Next Local Low})
* **Balance Drawdown Relative:** Highest % drop, local peak to next local low: \text{Relative Drawdown} = \max\left(\frac{\text{Local High} - \text{Next Local Low}}{\text{Local High}} \times 100\%\right)
* **Equity Drawdown (Absolute, Maximal, Relative):** Same calc as balance drawdowns, but continuous equity not closed balance.
* **Profit Factor:** Gross profit / gross loss ratio. 1.0 = break-even.
* **Recovery Factor:** Recovery speed + risk profile: \text{Recovery Factor} = \frac{\text{Total Net Profit}}{\text{Maximal Drawdown}}
* **AHPR (Arithmetic Holding Period Return):** Arithmetic mean equity change per trade.
* **GHPR (Geometric Holding Period Return):** Geometric mean per trade — true avg capital multiplier per trade.
* **Expected Payoff:** Statistical avg expected return of next single trade.
* **Sharpe Ratio:** Profitability vs risk: \frac{\text{Return} - \text{Risk-Free Rate}}{\text{Standard Deviation}}. Risk-Free Rate assumed zero in tester.
* **LR Correlation (Linear Regression):** How closely balance curve fits straight line (least-squares). Near 1 = stable growth.
* **LR Standard Error:** Standard error, balance deviation from regression line, in currency.
* **Margin Level:** Lowest margin % registered during test.
* **Z-Score:** Probability of correlation between consecutive trades (win/loss streaks). Above 3 = high prob win followed by loss; below -3 = win likely followed by win.
* **OnTester Result:** Custom value returned by OnTester() function in EA code, for optimization criteria.
* **MFE / MAE Correlations:**
    * **Correlation (Profits, MFE):** Relationship profit vs Maximum Favorable Excursion. Near 1 = strategy takes profit near peak potential.
    * **Correlation (Profits, MAE):** Relationship profit vs Maximum Adverse Excursion — evaluates stop-loss effectiveness during drawdowns.
    * **Correlation (MFE, MAE):** Correlation between favorable and adverse excursions.
* **Position Holding Times:** Min, Max, Average position lifetime, open to close.

## 4. Testing Report Diagrams
* **Entries by Hours / Weekdays / Months:** Distribution of entry deals (open, increase, reversal). Hours color-coded by session: **Asian (Yellow)**, **European (Green)**, **American (Red)**.
* **Profits and Losses by Hours / Weekdays / Months:** Distribution of exit deals (closure, partial closure, reversal). **Profitable deals (Blue)** vs **Losing deals (Red)**.
* **MFE-Profits Distribution:** Positions plotted, MFE vs Profit, evaluates protection quality of unrealized profit.
* **MAE-Profits Distribution:** Positions plotted, MAE vs Profit, evaluates trades re: drawdown outstaying.
* **Profit and Position Holding Time Distribution:** Holding time (X) vs profit (Y), identifies execution efficacy across time horizons.

## 5. Analytics: 5 Key Trading Metrics
**1. Sharpe Ratio**
* **Definition:** Strategy profitability vs risk.
* **Interpretation Thresholds:**
    * < 0: Unprofitable.
    * < 1.0: Risk not justified by performance.
    * \ge 1.0: Good — return justifies portfolio risk.
    * \ge 3.0: Excellent — low prob individual trade failure.

**2. Maximum Drawdown**
* **Definition:** Max peak-to-trough decline in balance.
* **Significance:** Shows capital portion at extreme risk during worst historical period. Target ideally below 20-30%.

**3. Recovery Factor**
* **Definition:** Total net profit / max registered drawdown.
* **Significance:** Shows recovery capacity from deep losses. Ideal strategy: Recovery Factor **> 3**.

**4. Profit Factor**
* **Definition:** Gross profits / gross losses ratio.
* **Significance:** Primary indicator long-term commercial efficiency. > 1.0 = net profitable.

**5. Maximum Deposit Load**
* **Definition:** Highest % account equity used as margin for open positions.
* **Significance:** High deposit load = drastically higher absolute risk. Under high leverage, elevated load means small adverse price moves trigger broker Stop Outs.

**Strategy Evaluation Case Study**
System w/ high nominal annual growth, smooth balance graphics, evaluated vs five core indices:
* Growth/balance graphs smooth — **Pass (**✔️**)**
* Recovery Factor = 8.26 — **Pass (**✔️**)**
* Profit Factor = 1.91 — **Pass (**✔️**)**
* Max. Deposit Load = 57% — **Pass (**✔️**)**
* Sharpe Ratio = 0.21 — **Fail (X)**
* Maximum Drawdown = 72.3% — **Fail (X)**

**Conclusion:** High nominal returns + recovery capability, but strategy **not** stable or safe. Profits depend entirely on aggressive, unhedged risk — total loss possible if market shifts. Eval must prioritize risk-adjusted indices over nominal returns.