# Sharpe & Sortino Ratio — Calculation Reference for MT5

Source: MQL5 article "Mathematics in trading: Sharpe and Sortino ratios" (MetaQuotes, 2022)

---

## Sharpe Ratio

```
Sharpe = (Return - RiskFree) / Std
```

- **Return** — average return per interval (daily, hourly, etc.)
- **RiskFree** — risk-free rate for same period; use `0` when comparing strategies against each other
- **Std** — standard deviation of returns for the same period

### Return per bar

```
Return[i] = (Close[i] - Close[i-1]) / Close[i-1]
```

Average over N bars:

```
Return = Sum(Return[i]) / N
```

### Standard deviation

```
D   = Sum((Return[i] - mean)^2) / N
Std = sqrt(D)
```

### Annualizing from any timeframe

Multiply the per-bar Sharpe by `sqrt(N)` where N = number of bars in the sample:

```
SharpeAnnual = SharpeTF * sqrt(N_bars)
```

Equivalently, convert step-by-step:

```python
# H1 → Annual
SharpeDaily  = sqrt(24)  * SharpeH1    # 24 H1 bars per day
SharpeAnnual = sqrt(252) * SharpeDaily # 252 trading days per year

# D1 → Annual
SharpeAnnual = sqrt(252) * SharpeD1
```

**From the MQL5 study (EURUSD 2020):** Annual Sharpe converges tightly across M1–M30 (range 1.03–1.08). Larger timeframes (H12, D1, MN1) diverge more. For cross-timeframe strategy comparison, prefer minute-bar returns.

---

## How MT5 Strategy Tester Computes Sharpe

MT5 uses **equity** (not price) and **log returns** (not simple returns):

```
log_return[i] = ln(equity[i] / equity[i-1])
```

Only bars where equity actually changed are included — flat periods with no open trades are excluded to avoid zero-inflation.

```python
# Pseudocode matching MT5 Sharpe.mqh
log_returns = []
prev_equity = equity[0]
for eq in equity[1:]:
    if eq != prev_equity:
        log_returns.append(math.log(eq / prev_equity))
        prev_equity = eq

N   = len(log_returns)
avg = sum(log_returns) / N
std = math.sqrt(sum((r - avg)**2 for r in log_returns) / N)
sharpe_tf = avg / std
sharpe_annual = sharpe_tf * math.sqrt(N)
```

**Log return advantage:** `ln(0.95) + ln(1.05/0.95)` recovers the original value; simple returns `(−5%) + (+5%)` do not. Log returns are additive across periods.

---

## Sortino Ratio

Sortino replaces full standard deviation with **downside deviation** (semi-deviation) — only negative returns count as risk:

```
Sortino = Return_avg / SemiStd
```

where:

```python
negative_only = [r if r < 0 else 0 for r in returns]
D_semi   = sum(x**2 for x in negative_only) / N   # include zero-return slots in denominator
SemiStd  = math.sqrt(D_semi)
```

> The denominator uses the **full** N (not just the count of negative bars). This matches MT5's implementation and the original Sortino formula.

### Ratio between Sortino and Sharpe

For currency pairs with roughly symmetrical return distributions, `Sortino ≈ 1.60 × Sharpe` consistently across timeframes (observed on EURUSD, GBPUSD, USDJPY, USDCHF for 2020). Use this as a sanity check when recomputing from raw deals.

---

## Interpretation (annualized values)

| Sharpe Annual | Meaning |
|---|---|
| < 0 | Unprofitable strategy |
| 0 – 1 | Risk does not pay off; use only if no alternatives |
| ≥ 1.0 | Risk pays off — strategy may produce positive results |
| ≥ 3.0 | Very good — low probability of loss on any individual trade |

These thresholds apply to the annualized value. Per-bar Sharpe before scaling is always much smaller.

---

## Recomputing from MT5 Parsed Data

MT5 reports `metrics.sharpe_ratio` directly in the Details block (`<!--REPORT_SHARPERATIO-->`). That value is already annualized and equity-log-return based. **Do not re-derive it from position profits** — equity includes open trades, swaps, commissions, and credits that positions alone miss.

When you need to compute Sharpe/Sortino from scratch (e.g. for a sub-period or custom timeframe):

```python
import math

def sharpe_sortino_from_deals(deals, timeframe_minutes=None):
    """
    deals: list of dicts with 'balance_after' and 'time' fields (from parsed MT5 JSON)
    Returns (sharpe_annual, sortino_annual) using log returns on equity curve.
    """
    balances = [d['balance_after'] for d in deals if d.get('balance_after') is not None]
    log_returns = []
    for i in range(1, len(balances)):
        if balances[i] != balances[i-1] and balances[i-1] > 0:
            log_returns.append(math.log(balances[i] / balances[i-1]))

    N = len(log_returns)
    if N < 2:
        return 0.0, 0.0

    avg = sum(log_returns) / N
    variance = sum((r - avg)**2 for r in log_returns) / N
    std = math.sqrt(variance)
    sharpe_tf = avg / std if std > 0 else 0.0

    # Semi-deviation (negative returns only, full-N denominator)
    neg_sq = sum(r**2 for r in log_returns if r < 0)
    semi_var = neg_sq / N
    semi_std = math.sqrt(semi_var)
    sortino_tf = avg / semi_std if semi_std > 0 else 0.0

    # Annualize
    scale = math.sqrt(N)
    return sharpe_tf * scale, sortino_tf * scale
```

---

## Source Boundaries (do not mix)

| What you want | Use |
|---|---|
| Official Sharpe from MT5 | `metrics.sharpe_ratio` (parsed from report) |
| Recompute for custom period | `deals[].balance_after` curve (log returns) |
| Per-symbol or per-month Sharpe | Slice `deals` by time, then apply `sharpe_sortino_from_deals()` |
| **Never** use `positions[].profit` alone | Missing swap, commission, credit — will give wrong Sharpe |
