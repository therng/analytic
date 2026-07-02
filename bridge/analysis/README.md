# Trade Evaluation Charts (Python)

Offline analysis tooling that reads the same Postgres database as the Next.js app
(`Position`, `PositionExcursion`, `EquityHistory` — see `prisma/schema.prisma`) and
builds two evaluation charts with Pandas + Matplotlib/Seaborn:

- **MAE/MFE scatter** — Maximum Adverse / Favorable Excursion per closed position,
  derived from `PositionExcursion` (60s profit samples taken while a position was open).
  60s resolution approximates true tick-level MAE/MFE — accurate for swing/grid EAs,
  coarse for sub-minute scalpers.
- **Absolute vs relative drawdown** — dual-axis chart over the account's `EquityHistory`.
  Formulas mirror `computeBalanceDrawdown()` in `src/lib/trading/analytics.ts` so results
  match the dashboard's MAX/ABS KPI chips: **maximal** drawdown is the peak-to-trough
  instance with the largest dollar amount, **relative** is the instance with the largest
  percentage — these can be two different drawdown episodes (MT5 convention).

Separate from `bridge/`'s live MT5→Redis streaming — this is offline historical
analysis and depends on the Postgres DB, not a running MT5 terminal.

## Setup

```bash
cd bridge/analysis
python -m venv .venv && source .venv/bin/activate   # or your preferred venv tool
pip install -r requirements.txt
echo "DATABASE_URL=postgresql://user:pass@host:5432/trading_db" > .env
```

## Usage

```bash
python report.py --account 7973357
# charts written to bridge/analysis/output/7973357_mae_mfe.png and 7973357_drawdown.png
```

## Modules

| File | Purpose |
|------|---------|
| `data.py` | Postgres loaders (`load_positions`, `load_position_excursions`, `load_equity_history`) |
| `metrics.py` | `compute_mae_mfe`, `compute_balance_drawdown`, `build_drawdown_series` |
| `plots.py` | `plot_mae_mfe_scatter`, `plot_drawdown_comparison` |
| `report.py` | CLI entrypoint wiring the above together |

Import `data`/`metrics`/`plots` directly in a notebook for ad-hoc exploration instead
of using the CLI.
