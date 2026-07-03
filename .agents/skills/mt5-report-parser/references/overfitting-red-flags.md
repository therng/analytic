# Over-Optimization & Red Flags in MT5 Strategy Reports

Source: MetaQuotes — "Number of Parameters in a Trading System"; "Optimization VS Reality: Evidence from ATC 2011"

---

## The Core Problem: Curve Fitting

**Curve fitting** occurs when a trading robot is optimized so precisely for a historical period that it learns the noise of that period rather than genuine market patterns. The robot performs well in the Strategy Tester but fails on any data outside the optimization window.

The more parameters a system has, the more degrees of freedom it has to fit historical data — and the less likely the identified pattern survives going forward.

---

## Red Flag 1: Too Many Input Parameters

### The evidence (ATC 2011 data)

In the Automated Trading Championship 2011, EAs were ranked by:
- Number of external parameters (X axis)
- Final balance over the forward (live) period (Y axis)

**Result:** EAs with a large number of parameters either lost money or barely broke even during the Championship. EAs with few parameters had the best forward performance.

### Rule of thumb

| Parameter count | Risk level |
|---|---|
| 1 – 3 | Low — hard to over-fit |
| 4 – 7 | Moderate — watch other red flags |
| 8 – 15 | High — likely to have hidden curve fitting |
| 15+ | Very high — almost certainly fitted |

**Hidden parameters trap:** An EA offered with no external parameters is not automatically safe. Developers sometimes hard-code parameters inside the source to hide the degree of fitting. Absence of visible parameters ≠ absence of internal optimization.

### What to check in the MT5 report

- If the EA has many parameters and shows very high metrics, test on an out-of-sample period (data the developer did not use for optimization)
- Look for the number of optimization passes in the report — a very large number of passes with few improvements suggests exhaustive fitting

---

## Red Flag 2: Very High Profit Factor

A Profit Factor significantly above normal ranges is a strong signal of over-optimization.

### ATC 2011 finding

EAs with very high Profit Factor during backtesting almost universally failed in the forward period — producing results near zero or negative. The high PF was due to extra filters (each with their own parameters) added to avoid losing trades in the test period.

### Thresholds

| Profit Factor | Assessment |
|---|---|
| 1.0 – 1.3 | Marginal — barely profitable |
| 1.3 – 2.0 | Normal range for a real system |
| 2.0 – 3.0 | Good, but watch total trade count |
| > 3.0 | Suspicious — likely over-optimized |
| > 5.0 | Almost certainly curve fitted |

**Context matters:** A high PF on 20 trades is meaningless. A PF of 2.5 on 500+ trades is credible.

**Mechanism:** Developers add filters to exclude known losing trades from the historical period. Each filter adds parameters. The filters work perfectly on the optimization data and fail on any new data.

---

## Red Flag 3: Sky-High Balance on Historical Data

A huge profit in the attached backtest report is a primary indicator of curve fitting, especially when:
- The profit is disproportionate to the initial deposit (e.g., 10,000% growth)
- The test period is short (1–2 years)
- The number of parameters is high

### ATC 2011 finding

EAs showing the largest profits during historical testing were among the worst performers in the live Championship. Buyers and developers alike genuinely believed in the results — mutual delusion is common with over-optimized systems.

### What to verify

1. **Out-of-sample test:** Re-run the EA on data before or after the stated optimization period. A genuine system maintains similar (not identical) metrics out-of-sample.
2. **Walk-forward analysis:** Repeatedly optimize on a rolling window and check if performance degrades badly outside each window.
3. **Balance smoothness:** A sky-high final balance with severe intermediate drawdowns is a warning sign even if balance recovered.

---

## Red Flag 4: Money Management Manipulation

The most sophisticated form of curve fitting involves custom money management rules (not true MM) that:
- Increase position size specifically when historical data shows wins
- Reduce or skip trades specifically when historical data shows losses
- Use look-ahead logic that cannot work in live trading

This is distinct from legitimate money management (position sizing based on account equity or volatility). Manipulative MM navigates the specific historical path without any predictive power.

**Detection:** Test the EA on data outside the developer's stated period. The more extensive the manipulation, the more catastrophically it fails on new data.

---

## Red Flag 5: No Live Track Record

A positive Strategy Tester report is necessary but insufficient. Backtesting cannot catch:
- Logic errors triggered only by rare live-market conditions
- Broker-specific quirks (spread, slippage, requotes)
- Unexpected API/server conditions the developer could not foresee

**Only the MetaTrader Signals service provides a verified live track record.** An EA that has traded profitably via Signals over a sufficient period (6+ months, 200+ trades) is substantially more credible than any backtest result alone.

---

## Summary: Evaluating an MT5 Report for Reliability

When reviewing a Strategy Tester report, check in this order:

1. **Trade count** — < 30 trades: statistically meaningless. < 100: treat metrics as preliminary.
2. **Parameter count** — more than ~7 external params: require out-of-sample confirmation.
3. **Profit Factor** — > 3.0 on historical data: high suspicion of curve fitting.
4. **Profit magnitude** — 1000%+ return: require multi-year out-of-sample test.
5. **Sharpe Ratio** — > 3.0 is excellent in live trading; > 5.0 in backtesting raises questions.
6. **LR Correlation + smoothness** — a perfectly smooth balance curve (LR Corr = 1.00) on historical data can indicate stop-hunting or data-fitted exits, not real skill.
7. **Live signals** — prioritize over any backtest.

**The two rules that remain valid:**
- Do not trust anyone.
- No past trading successes can guarantee future profits.
