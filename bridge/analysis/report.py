"""
CLI: build the MAE/MFE scatter and absolute-vs-relative drawdown charts for one account.

Usage:
  python bridge/analysis/report.py --account 7973357
  python bridge/analysis/report.py --account 7973357 --out bridge/analysis/output
"""

import argparse
from pathlib import Path

from data import get_engine, load_equity_history, load_position_excursions, load_positions
from metrics import build_drawdown_series, compute_balance_drawdown, compute_mae_mfe
from plots import plot_drawdown_comparison, plot_mae_mfe_scatter


def run(account_no: str, out_dir: str) -> None:
    engine = get_engine()

    positions = load_positions(account_no, engine)
    excursions = load_position_excursions(account_no, engine)
    equity_history = load_equity_history(account_no, engine)

    if positions.empty:
        print(f"No closed positions found for account {account_no}.")
    else:
        mae_mfe = compute_mae_mfe(positions, excursions)
        n_with_excursion = mae_mfe["mae"].notna().sum()
        print(f"{len(positions)} closed positions, {n_with_excursion} with excursion samples.")
        scatter_path = plot_mae_mfe_scatter(mae_mfe, Path(out_dir) / f"{account_no}_mae_mfe.png", account_no)
        print(f"Saved {scatter_path}")

    if equity_history.empty:
        print(f"No equity history found for account {account_no}.")
    else:
        dd_summary = compute_balance_drawdown(equity_history, value_col="balance")
        print(f"Maximal drawdown:  ${dd_summary['maximalAmount']:.2f} ({dd_summary['maximalPercent']:.2f}%)")
        print(f"Relative drawdown: ${dd_summary['relativeAmount']:.2f} ({dd_summary['relativePercent']:.2f}%)")

        dd_series = build_drawdown_series(equity_history, value_col="balance")
        dd_path = plot_drawdown_comparison(dd_series, Path(out_dir) / f"{account_no}_drawdown.png", account_no)
        print(f"Saved {dd_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build MAE/MFE + drawdown evaluation charts")
    parser.add_argument("--account", required=True, help="Account number (TradingAccount.accountNo)")
    parser.add_argument("--out", default=str(Path(__file__).parent / "output"))
    args = parser.parse_args()

    run(args.account, args.out)
