---
name: mt5-report-parser
description: >
  This skill should be used when the user asks to "parse an MT5 report", "read a MetaTrader 5 HTML file",
  "extract positions from MT5 export", "compute Sharpe ratio from MT5 data", "build a pipeline for MT5 account statements",
  "visualize MT5 balance curve", or when debugging missing or incorrect fields in parsed MT5 output.
  Covers the full workflow: HTML parsing → JSON normalization → metric computation → visualization.
---

# MT5 Report Parser & Visualizer

## Overview

MT5 exports account history as a structured HTML file built from a fixed template (`ReportHistory.htm`).
Full workflow: **parse → normalize → compute → visualize**.

---

## Phase 1 — Parse HTML to Structured JSON

### Step 1: Detect encoding

MT5 exports in multiple encodings. Detect before parsing:

```python
def decode_mt5_report(raw_bytes: bytes) -> str:
    if raw_bytes[:2] == b'\xff\xfe':          # UTF-16 LE (most common)
        return raw_bytes.decode('utf-16-le')
    if raw_bytes[:2] == b'\xfe\xff':          # UTF-16 BE
        return raw_bytes[2:].decode('utf-16-be')
    if raw_bytes[:3] == b'\xef\xbb\xbf':      # UTF-8 BOM
        return raw_bytes[3:].decode('utf-8')
    return raw_bytes.decode('utf-8')          # Plain UTF-8
```

### Step 2: Identify and parse each section

Section headers appear as `<th colspan="N">` rows. Detect them before reading data rows.

**Section order in ReportHistory.htm:**
```
Positions → Orders → Deals → [Open Positions] → [Working Orders] → Summary → Details
```
Bracketed sections are absent when the account has no open trades.

> Load `references/field-mapping.md` for the complete HTML placeholder → JSON key mapping.

### Step 3: Output standardized JSON

The canonical output schema is in `references/json-schema.md`. All downstream analysis expects this exact structure.

**Quick validation checklist after parsing:**
- `meta.account_number` is a numeric string (≥5 digits)
- `meta.report_timestamp` is ISO-8601 with +07:00 offset (Bangkok time)
- `summary.balance > 0`
- `positions` array sorted by `open_time` ascending
- `deals` array sorted by `time` ascending
- `metrics.drawdown` has all 5 sub-fields populated (even if 0)

---

## Phase 2 — Compute Metrics

All formulas operate on the parsed JSON. Never recompute from raw HTML.

### Core metric formulas

| Metric | Formula |
|---|---|
| **Expected Payoff** | `total_net_profit / total_trades` |
| **Profit Factor** | `gross_profit / abs(gross_loss)` |
| **Recovery Factor** | `abs(total_net_profit) / maximal_drawdown_amount` |
| **Equity** | `balance + credit_facility - commission ± floating_pl - blocked` |
| **Max Deposit Load %** | `(margin / equity) × 100` |
| **positionNetPnl** | `profit + swap + commission` — never profit alone |

For AHPR, GHPR, LR Correlation, Z-Score, MAE/MFE, and Money Compounding formulas → load `references/advanced-metrics.md`.

For Sharpe and Sortino ratio formulas, annualization, and MT5's log-return method → load `references/sharpe-sortino.md`.

### Drawdown — 3 distinct calculations

```
Absolute DD  = initial_deposit − min(balance_over_time)
               "Did we ever go below the starting amount?"

Maximal DD   = max over all peaks of: peak_balance − next_trough
               "Largest drop in currency units"

Relative DD  = max over all peaks of: (peak − trough) / peak × 100
               "Largest drop as % of that peak"
```

**From HTML report:** Maximal and Relative appear as `amount (percent%)` in one cell — formats are reversed:
```
"800.00 (8.50%)"  →  maximal_amount=800.00, maximal_pct=8.50
"12.30% (650.00)" →  relative_pct=12.30,    relative_amount=650.00
```

### Consecutive sequences — reversed format (common mistake)

- `Maximum Consecutive Wins ($)` → `count ($amount)` — count first, amount in parens
- `Maximal Consecutive Profit (count)` → `$amount (count)` — amount first, count in parens

### Deal classification

```python
def is_trading_deal(deal):
    return bool(deal.get('symbol')) and bool(deal.get('direction'))

def is_balance_deal(deal):
    return deal.get('type', '').lower() in ('balance', 'credit')
```

Only `is_trading_deal` rows contribute to P/L metrics. Balance deals update the equity curve.

### Metric quality thresholds

For complete thresholds (Sharpe, Sortino, Recovery Factor, Profit Factor, LR Correlation, GHPR, Max Deposit Load, Drawdown, and the drawdown 2× rule) → load `references/advanced-metrics.md`.

Quick reference for color coding:

| Metric | Green | Yellow | Red |
|---|---|---|---|
| Sharpe Ratio | ≥ 1.0 | 0 – 1 | < 0 |
| Max DD % | < 20% | 20–30% | > 30% |
| Recovery Factor | ≥ 3.0 | 1–3 | < 1 |
| Profit Factor | > 1.5 | 1.0–1.5 | < 1.0 |
| Max Deposit Load | < 30% | 30–50% | > 50% |

---

## Phase 3 — Visualize

| Need | Approach |
|---|---|
| Balance/equity curve | Line chart from `deals[].balance_after` over `deals[].time` |
| Drawdown chart | Running max → `(running_max - current) / running_max × 100` |
| Win/loss distribution | Bar chart: profit_trades vs loss_trades by symbol or month |
| P&L heatmap | `positions[].net_pnl` grouped by `symbol` × `month` |
| Monthly summary | Group `deals` by Bangkok-month, sum `is_trading_deal` profits |

**Run the bundled script** for a full CLI parse + chart export:
```bash
python .Codex/skills/mt5-report-parser/scripts/parse_mt5.py \
  --input path/to/report.html \
  --output report.json \
  --charts charts/
```

---

## Quick Reference — Common Operations

```python
import json
report = json.load(open('report.json'))

# Net P/L per position (always include swap + commission)
for pos in report['positions']:
    pos['net_pnl'] = pos['profit'] + pos['swap'] + pos['commission']

# Balance curve (from deals, not positions)
balance_curve = [
    (d['time'], d['balance_after'])
    for d in report['deals']
    if d.get('balance_after') is not None
]

# Win rate
wins = report['metrics']['win_stats']['profit_trades']
total = report['metrics']['total_trades']
win_rate = wins / total if total else 0

# Symbol breakdown
from collections import defaultdict
by_symbol = defaultdict(list)
for pos in report['positions']:
    by_symbol[pos['symbol']].append(pos['profit'] + pos['swap'] + pos['commission'])
```

---

## Common Mistakes

| Mistake | Fix |
|---|---|
| Using `position.profit` alone | Always add `+ swap + commission` |
| Computing drawdown from `positions` | Use `deals` balance curve — positions miss intraday moves |
| Treating all deals as trades | Filter with `is_trading_deal()` — balance ops skew metrics |
| Ignoring NBSP in number parsing | Replace `\xa0` before `float()` |
| Parsing `(1,234.56)` as positive | Leading `(` means negative |
| Swapping Maximal vs Relative DD format | Maximal: amount(pct); Relative: pct(amount) |
| Assuming UTF-8 encoding | Always detect BOM — MT5 usually exports UTF-16 LE |

---

## Reference Files

- `references/field-mapping.md` — every MT5 HTML placeholder → JSON key, type, notes
- `references/json-schema.md` — full standardized JSON output schema with examples
- `references/sharpe-sortino.md` — Sharpe & Sortino formulas, MT5 log-return method, Python implementation
- `references/advanced-metrics.md` — HPR/AHPR/GHPR, Z-Score, LR Correlation, MAE/MFE, Money Compounding, comprehensive thresholds
- `references/overfitting-red-flags.md` — over-optimization detection: parameter count, high PF, sky-high backtest profit, live track record
- `scripts/parse_mt5.py` — standalone CLI parser: HTML → JSON + optional chart export

**Cross-skill reference:** For importing parsed MT5 data into the Analytic project (worker, Prisma upserts, analytics layer, dashboard KPIs) → `mt5-import-pipeline`.
