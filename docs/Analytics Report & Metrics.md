# MetaTrader 5 Analytics Report & Metrics Guide  
## 1. Trading Report Overview  
The trading report presents trading results in a visual format to assist in evaluating performance, optimizing portfolios, and analyzing trading stability against risk.  
**Report Tabs Breakdown**  
* **Summary:** An overview of trading over time. Contains overall profit and loss metrics, deposit and withdrawal amounts, balance, growth, and dividends graphs.  
* **Profit/Loss:** Details on profitable and losing trades, categorized by trading types (manual, algorithmic, and copy trading). Results can be analyzed in the context of trades or money by months and years.  
* **Long/Short:** Dynamic ratio of Buy and Sell trades at specified time periods, as well as the profitability of Buy and Sell directions.  
* **Symbols:** Analysis of trades by financial instruments, showing which symbols yield gains or losses, trading frequency, and graphs of trades and monetary volumes.  
* **Risks:** Visualizes key risk characteristics of a strategy using drawdown and deposit load graphs, alongside the ratio of profitable and losing trades.  
**Drawdown & Deposit Load Graphs**  
* **Drawdown graph:** Visualizes equity or balance drops applied directly over the balance change graph to show capital degradation periods.  
* **Deposit Load graph:** Displays the percentage of account equity utilized as margin over time, mapped against the balance change graph to evaluate risk aggressiveness.  
## 2. Trade History Structures  
**A. Orders Record Data**  
Represents the parameters of placed trade requests.  
1. **Symbol:** The financial instrument of the order.  
2. **Symbol:** The financial instrument of the order.  
3. **Type:** Type of the order (e.g., Buy, Sell, Sell Stop, Sell Limit, Buy Stop, Buy Limit, Buy Stop Limit, or Sell Stop Limit).  
4. **Type:** Type of the order (e.g., Buy, Sell, Sell Stop, Sell Limit, Buy Stop, Buy Limit, Buy Stop Limit, or Sell Stop Limit).  
5. **#:** The ticket number (a unique identifier) of the trade operation.  
6. **#:** The ticket number (a unique identifier) of the trade operation.  
7. **Volume:** Volume requested in the order (in lots or units).  
8. **Volume:** Volume requested in the order (in lots or units).  
9. **Price:** Price specified in the order at which the trade operation should be executed.  
10. **Price:** Price specified in the order at which the trade operation should be executed.  
11. **State:** Result of the order placing (e.g., Filled, Partially, Canceled).  
12. **State:** Result of the order placing (e.g., Filled, Partially, Canceled).  
13. **Time:** The time when the order was placed (YYYY.MM.DD HH:MM).  
14. **Time:** The time when the order was placed (YYYY.MM.DD HH:MM).  
15. **S/L:** Level of the placed Stop Loss order (colored red if closed by S/L).  
16. **S/L:** Level of the placed Stop Loss order (colored red if closed by S/L).  
17. **T/P:** Level of the set Take Profit order (colored green if closed by T/P).  
18. **T/P:** Level of the set Take Profit order (colored green if closed by T/P).  
19. **Comment:** A comment added by the trader or automatically by the system (e.g., [sl price] or [tp price]).  
20. **Comment:** A comment added by the trader or automatically by the system (e.g., [sl price] or [tp price]).  
21. **Comment:** A comment added by the trader or automatically by the system (e.g., [sl price] or [tp price]).  
22. **Comment:** A comment added by the trader or automatically by the system (e.g., [sl price] or [tp price]).  
23. **Comment:** A comment added by the trader or automatically by the system (e.g., [sl price] or [tp price]).  
24. **Comment:** A comment added by the trader or automatically by the system (e.g., [sl price] or [tp price]).  
**B. Deals Record Data**  
Represents the actual execution data of a trade. Deals triggered by Stop Loss are highlighted in red; those triggered by Take Profit are highlighted in green.  
* **Summary Metrics:** Deposit (sum of deposits/withdrawals), Profit (excluding swaps/commissions), Swap, Commission, and Balance.  
* **Detailed Fields:** Direction (in, out, or in/out), Volume, Price, Profit (zero for entry deals), \Delta (difference between open and close price in points/percentages for exit trades), Order ticket number, Fee (separate broker fee), and Comment.  
**C. Positions Record Data**  
Aggregated data combining all deals related to a single market position (opening, volume additions, partial closures, and full closure):  
* Position opening and closing time (determined by the first and last trade).  
* Position volume (contains both current closed volume and source volume if partially closed).  
* The weighted average open and close prices of the position.  
* The total financial result of deals related to the position (excluding swaps and commissions).  
## 3. Testing Report Parameters  
Definitive performance metrics generated within the Strategy Tester for automated execution evaluation:  
* **History Quality:** The percentage ratio of correct and incorrect 1-minute data. Gaps or bars with a volume equal to 1 with different OHLC values reduce this score.  
* **Bars / Ticks / Symbols:** The exact count of bars generated, ticks modeled, and total symbols requested during the testing routine.  
* **Initial Deposit / Withdrawal:** The starting capital and the total money withdrawn during the run.  
* **Total Net Profit:** The final financial result of all trades (Gross Profit - Gross Loss).  
* **Gross Profit / Gross Loss:** The standalone sum of all profitable trades and all losing trades respectively.  
* **Balance Drawdown Absolute:** Difference between the initial deposit and the minimal balance level reached below it: \text{Absolute Drawdown} = \text{Initial Deposit} - \text{Minimal Balance}   
* **Balance Drawdown Maximal:** The highest drop from a local balance peak to the next local balance low in deposit currency: \text{Maximal Drawdown} = \max(\text{Local High} - \text{Next Local Low})   
* **Balance Drawdown Relative:** The highest percentage drop from a local balance peak to the next local balance low: \text{Relative Drawdown} = \max\left(\frac{\text{Local High} - \text{Next Local Low}}{\text{Local High}} \times 100\%\right)   
* **Equity Drawdown (Absolute, Maximal, Relative):** Calculated exactly like the balance drawdowns, but utilizing continuous equity valuations rather than closed balance metrics.  
* **Profit Factor:** Ratio of gross profit to gross loss. A value of 1.0 means break-even.  
* **Recovery Factor:** Reflects the recovery speed and risk profile of the strategy, calculated as: \text{Recovery Factor} = \frac{\text{Total Net Profit}}{\text{Maximal Drawdown}}   
* **AHPR (Arithmetic Holding Period Return):** Arithmetic mean of equity changes per trade.  
* **GHPR (Geometric Holding Period Return):** Geometric mean of a trade, representing the true objective average multiplier of capital change per trade.  
* **Expected Payoff:** A statistical calculation showing the average expected return of the next single trade.  
* **Sharpe Ratio:** Measures strategy profitability relative to risk: \frac{\text{Return} - \text{Risk-Free Rate}}{\text{Standard Deviation}}. The Risk-Free Rate is assumed to be zero in the tester.  
* **LR Correlation (Linear Regression):** Measures how closely the balance curve fits a straight line calculated via the least-squares method. Values close to 1 indicate stable growth.  
* **LR Standard Error:** The standard error of balance deviation from the linear regression line in monetary terms.  
* **Margin Level:** The lowest margin percentage level registered during the entire test.  
* **Z-Score:** Measures the probability of correlation between consecutive trades (win/loss streaks). A value above 3 indicates a high probability that a win is followed by a loss; below -3 indicates a win is likely followed by another win.  
* **OnTester Result:** The custom value returned by the OnTester() function inside the EA code for optimization criteria.  
* **MFE / MAE Correlations:**  
    * **Correlation (Profits, MFE):** Measures the relationship between profit and Maximum Favorable Excursion. Higher correlation (near 1) means the strategy takes profit near peak potential.  
    * **Correlation (Profits, MAE):** Measures the relationship between profit and Maximum Adverse Excursion, evaluating the effective use of protective stops during adverse drawdowns.  
    * **Correlation (MFE, MAE):** Correlation between favorable and adverse excursions.  
* **Position Holding Times:** Breaks down the Minimal, Maximal, and Average position lifetimes from full opening to full elimination.  
## 4. Testing Report Diagrams  
* **Entries by Hours / Weekdays / Months:** Displays the distribution of market entry deals (open, increase, reversal). Entry hours are color-coded by trading sessions: **Asian (Yellow)**, **European (Green)**, and **American (Red)**.  
* **Profits and Losses by Hours / Weekdays / Months:** Displays the distribution of market exit deals (closure, partial closure, reversal). Bars show **Profitable deals (Blue)** vs. **Losing deals (Red)**.  
* **MFE-Profits Distribution:** Positions are plotted as dots on an MFE vs. Profit plane to evaluate the protection quality of unrealized profit.  
* **MAE-Profits Distribution:** Positions are plotted on a MAE vs. Profit plane to evaluate trades in terms of drawdown outstaying.  
* **Profit and Position Holding Time Distribution:** Maps trade holding time (X-axis) against profit obtained (Y-axis) to identify execution efficacy across time horizons.  
## 5. Analytics: 5 Key Trading Metrics  
**1. Sharpe Ratio**  
* **Definition:** A measure of strategy profitability in relation to its risk.  
* **Interpretation Thresholds:**  
    * < 0: Unprofitable strategy.  
    * < 1.0: Risks are not justified by performance.  
    * \ge 1.0: Good. The return safely justifies the underlying portfolio risk.  
    * \ge 3.0: Excellent. Low probability of individual trade failure.  
**2. Maximum Drawdown**  
* **Definition:** The maximum peak-to-trough decline in account balance.  
* **Significance:** Shows the exact portion of capital put at extreme risk during the worst historical trading period. Target values should ideally remain below 20% to 30%.  
**3. Recovery Factor**  
* **Definition:** The ratio of total generated net profit to the maximum registered drawdown.  
* **Significance:** Demonstrates the strategy's capacity to recover from deep losses. An ideal strategy must maintain a Recovery Factor **greater than 3**.  
**4. Profit Factor**  
* **Definition:** The ratio of gross profits to gross losses.  
* **Significance:** Serves as the primary indicator of long-term commercial efficiency. Any value greater than 1.0 proves net profitability.  
**5. Maximum Deposit Load**  
* **Definition:** The highest percentage of account equity utilized as margin to maintain open positions.  
* **Significance:** High deposit loads drastically increase absolute risk. Under high leverage environments, elevated deposit loads mean minor price movements against the position can trigger broker Stop Outs.  
**Strategy Evaluation Case Study**  
A system displaying high nominal annual growth with smooth balance graphics, evaluated against the five core indices:  
* Growth and balance graphs are smooth — **Pass (**✔️**)**  
* Recovery Factor = 8.26 — **Pass (**✔️**)**  
* Profit Factor = 1.91 — **Pass (**✔️**)**  
* Max. Deposit Load = 57% — **Pass (**✔️**)**  
* Sharpe Ratio = 0.21 — **Fail (X)**  
* Maximum Drawdown = 72.3% — **Fail (X)**  
**Conclusion:** Despite high nominal returns and high recovery capability, this strategy **cannot** be considered stable or safe. The profits are entirely dependent on highly aggressive, unhedged risks that could result in a total loss of funds if market conditions shift. Performance evaluation must prioritize risk-adjusted indices over nominal returns.  
