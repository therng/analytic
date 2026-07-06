# Advanced MT5 Metrics — Formulas & Official Definitions

Sources: MetaQuotes Testing Report (official MT5 help), "Mathematics in Trading: How to Estimate Trade Results" (2007), "5 Key Trading Metrics" (2023)

---

## HPR / AHPR / GHPR

**HPR (Holding Period Return)** — relative result of a single trade:

```
HPR = BalanceClose / BalanceOpen
```

A trade with +10% profit → HPR = 1.10. A trade with −10% loss → HPR = 0.90.

**AHPR (Arithmetic Mean HPR):**

```
AHPR = Sum(HPR[i]) / N
```

`AHPR - 1` gives the average % earned per trade. Overestimates system profitability because arithmetic compounding inflates the result (multiply by N ≠ actual growth). MT5 shows the percentage in brackets.

**GHPR (Geometric Mean HPR):**

```
GHPR = (BalanceClose / BalanceOpen) ^ (1/N)
```

GHPR is the true growth factor per trade under reinvestment. Always ≤ AHPR. A GHPR < 1.0 means the system loses money when compounded. This is a better long-term predictor than AHPR.

**Key distinction:** A system can have impressive AHPR but negative GHPR if drawdowns are severe — GHPR reveals the real compounding effect.

---

## Z-Score

Z-Score measures whether profitable and losing trades alternate more or less than would be expected from a random sequence. It tests for serial correlation between consecutive trade outcomes.

```
Z = (N * (R - 0.5) - P) / sqrt(P * (P - N) / (N - 1))

where:
  N = total trades
  R = total number of "runs" (consecutive streaks of wins or losses)
  P = 2 * W * L
  W = total winning trades
  L = total losing trades
```

A "run" is a consecutive sequence of same-sign results (e.g., `+++` = 1 run, `---` = 1 run).

### Interpretation

| Z-Score | Probability | Dependence Type |
|---|---|---|
| ≤ −3.0 | 99.73% | **Positive** — win follows win, loss follows loss |
| −2.0 | 95.45% | Positive |
| −1.5 to +1.5 | <87% | **Indeterminate** — no reliable pattern |
| +2.0 | 95.45% | **Negative** — win follows loss, loss follows win |
| ≥ +3.0 | 99.73% | Negative |

**Positive dependence** (Z < 0): trades cluster. Useful for position sizing — increase size after a win, decrease after a loss.

**Negative dependence** (Z > 0): trades alternate. Useful for anti-martingale sizing — increase after a loss, decrease after a win.

**Trading implication:** `|Z| > 2.0` is worth investigating. Simultaneous multi-position EAs (e.g., opening 3 trades at once) will produce strong negative Z-Score because all trades are correlated.

---

## LR Correlation & LR Standard Error

The balance curve (broken line) is fitted to a straight line using least-squares method. This line is the **linear regression (LR)** of the balance.

**LR Standard Error** — deviation of balance from the regression line in currency terms:

```
LR_StdError = sqrt( Sum(d[i]^2) / (N - 2) )
where d[i] = balance[i] - regression_value[i]
```

Only comparable between systems with the same initial deposit. The higher the value, the more erratic the balance curve.

**LR Correlation** — correlation between the balance graph and its regression line:

```
r = cov(Balance, Regression) / (Sx * Sy)

where:
  cov(X, Y) = M( (X - M(X)) * (Y - M(Y)) )
  Sx = sqrt( Sum((Balance[i] - M(Balance))^2) / N )
  Sy = sqrt( Sum((Reg[i] - M(Reg))^2) / N )
```

Range: −1 to +1. In MT5's report, sign indicates profitability direction:
- **Positive (+)** → trending upward (profitable)
- **Negative (−)** → trending downward (losing; even a net-positive account can have negative LR Correlation if the trend is down late)
- **Close to 1.0** → smooth, consistent equity growth
- **Close to 0** → random, unpredictable trading

**From ATC 2006 data:** Top 15 winners had LR Correlation 0.58–1.00. The smoothest balance (vgc: 0.95, alexgomel: 0.95) did not always yield highest profit.

---

## MAE & MFE (Maximum Adverse / Favorable Excursion)

Every trade has a **lifetime** between open and close during which floating P/L fluctuates. Two key measurements per trade:

- **MAE (Maximum Adverse Excursion)** — largest unrealized loss during the trade's lifetime (how deep the position went against you before closing)
- **MFE (Maximum Favorable Excursion)** — largest unrealized profit during the trade's lifetime (the peak paper profit before closing)

Both measured in currency (not pips) for multi-symbol portfolios.

### Three Correlations

**Correlation(Profits, MFE):**
- Each closed trade plotted as point `(MFE, Result)` on a chart
- A regression line `Profit = A*MFE + B` is fitted
- **Close to 1** → trades capture most of their paper profit (take-profit or trailing stop working)
- **Close to 0** → weak relationship; profits are unrelated to paper peak
- Positive value → trades that ran far in profit tended to close profitably

**Correlation(Profits, MAE):**
- Each closed trade plotted as point `(MAE, Result)` on a chart
- **Negative slope** (negative correlation) → trades with larger drawdowns during their lifetime still ended profitably — the system "sits out" adverse moves. Risky pattern.
- **Close to 0** → stop losses are used effectively; large MAE rarely leads to profit
- From RobinHood ATC 2006: `Corr(Profits, MAE) = −0.59` with zero losing trades — every trade had MAE from −$120 to −$2500 but was still closed profitably.

**Correlation(MFE, MAE):**
- Shows if trades that moved far in your favor also had large drawdowns (or vice versa)
- **Ideal value = 1** — maximum paper profit was accompanied by maximum protection
- **Close to 0** → practically no correlation between the two

### Diagnostic patterns

| Pattern | What it means |
|---|---|
| `Corr(Profits, MAE)` strongly negative | System "sits out" losers — very risky |
| `Corr(Profits, MFE)` close to 1 | Profits are proportional to how far price moved in your favor |
| Small MAE on winning trades | Stop losses are working; no large reversals before winning |
| Large MFE but small final profit | Take-profit is set too tight; trailing stop may improve results |

---

## Trade Normalization & Money Compounding

### Normalized Profit (NP)

When position sizes vary, raw profits cannot be compared across trades fairly. Normalize to the minimum lot size:

```
NP[i] = TradeProfit[i] / TradeLots[i] * MinimumLots
```

This converts every trade's result to what it would have been if traded at the minimum position size. Enables apples-to-apples comparison across different account sizes and MM systems.

### Money Compounding (Beta)

Measures how much more volatile the actual results are compared to normalized (base) trading:

```
MoneyCompounding = cov(Profits, NP) / D(NP)

where:
  cov(Profits, NP) = M( (Profits - M(Profits)) * (NP - M(NP)) )
  D(NP) = M( (NP - M(NP))^2 )
```

Interpretation: `MoneyCompounding = 17.27` means actual position sizing caused 17× more capital volatility than minimum-lot trading would have. In ATC 2006, the maximum was 50 (50 lots / 0.1 minimum). Winners' values: 17.27, 28.79, 16.54 — not the largest. Evidence that aggressive MM does not guarantee top performance.

**Use case:** Compare `Corr(Profits, MAE)` vs `Corr(NormalizedProfits, MAE)`. Large divergence means MM has significantly altered the system's risk profile.

---

## Balance vs. Equity Drawdowns

MT5 calculates drawdown twice — once on Balance, once on Equity (balance + floating P/L):

| Metric | Based on | Formula |
|---|---|---|
| **Balance DD Absolute** | Balance | `InitialDeposit − MinBalance` (only counts drops below initial) |
| **Balance DD Maximal** | Balance | `max(LocalHigh − NextLocalLow)` in currency |
| **Balance DD Relative** | Balance | `max((LocalHigh − NextLocalLow) / LocalHigh × 100)` |
| **Equity DD Absolute** | Equity | Same formula as Balance, on equity curve |
| **Equity DD Maximal** | Equity | Same formula as Balance, on equity curve |
| **Equity DD Relative** | Equity | Same formula as Balance, on equity curve |

**Critical difference:** Equity drawdown includes open-position floating losses. A strategy that holds large losing positions will show much larger Equity DD than Balance DD, even if balance looks stable.

**If withdrawals occur during testing:** MT5 restarts drawdown calculation from current balance/equity after each withdrawal. Final report shows the highest drawdown across all segments.

---

## Comprehensive Quality Thresholds

| Metric | Excellent | Good | Warning | Critical |
|---|---|---|---|---|
| **Sharpe Ratio** | ≥ 3.0 | ≥ 1.0 | 0 – 1.0 | < 0 |
| **Sortino Ratio** | ≥ 5.0 | ≥ 1.6 | 0 – 1.6 | < 0 |
| **Recovery Factor** | > 5.0 | ≥ 3.0 | 1.0 – 3.0 | < 1.0 |
| **Profit Factor** | > 2.0 | > 1.5 | 1.0 – 1.5 | < 1.0 |
| **Balance DD Relative** | < 10% | < 20% | 20 – 30% | > 30% |
| **Equity DD Relative** | < 15% | < 25% | 25 – 40% | > 40% |
| **Max Deposit Load** | < 20% | < 30% | 30 – 50% | > 50% |
| **LR Correlation** | > 0.95 | > 0.8 | 0.5 – 0.8 | < 0.5 |
| **GHPR** | > 1.03 | > 1.01 | 1.0 – 1.01 | < 1.0 |

### Drawdown 2× Rule

Historical maximum drawdown should be assumed to double in live trading:
- Historical 20% DD → plan for 40% in production
- Historical 30% DD → plan for 60% in production  
- Historical 72% DD → may reach 100% (account wipeout)

**Recommended ceiling:** Historical relative DD ≤ 20% (so live risk stays ≤ 40%).

---

## Expected Payoff

```
Expected Payoff = Total Net Profit / Total Trades
```

The average monetary result of the next trade. Positive = profitable on average. In the Analytic runtime, compute this from closed `Position` or `Deal` data according to the project metric contract.

---

## Minimum Sample Size

Statistical conclusions require at least **30 trades** for basic validity. Below 30, no metric is reliably interpretable. For Sharpe/Z-Score/LR Correlation to be meaningful, 100+ trades is preferred.
