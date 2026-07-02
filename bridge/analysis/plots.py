"""
Evaluation charts: MAE/MFE scatter and absolute-vs-relative drawdown comparison.
"""

from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns

sns.set_theme(style="darkgrid")

POSITIVE = "#3dd68c"  # matches --positive in design-system/trading-monitor/MASTER.md
NEGATIVE = "#f04d4d"  # matches --negative
NEUTRAL = "#4da8f5"   # matches --neutral


def plot_mae_mfe_scatter(df: pd.DataFrame, out_path: str | Path, account_no: str) -> Path:
    """
    x = MAE (worst drawdown while open, <= 0), y = MFE (best excursion while open, >= 0).
    Point color = win/loss by net_pnl; point size = |net_pnl|.
    Trades sitting near the diagonal (MAE ~ -MFE) had symmetric excursion; trades with
    large MAE relative to final profit indicate the EA is riding out deep drawdowns to win.
    """
    plot_df = df.dropna(subset=["mae", "mfe"]).copy()
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    fig, ax = plt.subplots(figsize=(9, 7))
    colors = plot_df["net_pnl"].apply(lambda v: POSITIVE if v >= 0 else NEGATIVE)
    sizes = (plot_df["net_pnl"].abs().clip(lower=1) ** 0.5) * 8 + 20

    ax.scatter(plot_df["mae"], plot_df["mfe"], c=colors, s=sizes, alpha=0.7, edgecolors="none")
    ax.axhline(0, color="white", linewidth=0.5, alpha=0.3)
    ax.axvline(0, color="white", linewidth=0.5, alpha=0.3)
    ax.set_xlabel("MAE — Maximum Adverse Excursion ($)")
    ax.set_ylabel("MFE — Maximum Favorable Excursion ($)")
    ax.set_title(f"MAE / MFE — account {account_no} ({len(plot_df)} positions)")
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return out_path


def plot_drawdown_comparison(dd_series: pd.DataFrame, out_path: str | Path, account_no: str,
                              time_col: str = "report_date") -> Path:
    """Dual-axis: absolute drawdown ($) vs relative drawdown (%) over time."""
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    fig, ax1 = plt.subplots(figsize=(11, 6))
    ax1.plot(dd_series[time_col], dd_series["drawdown_absolute"], color=NEGATIVE, label="Absolute DD ($)")
    ax1.set_xlabel("Report date")
    ax1.set_ylabel("Absolute drawdown ($)", color=NEGATIVE)
    ax1.tick_params(axis="y", labelcolor=NEGATIVE)

    ax2 = ax1.twinx()
    ax2.plot(dd_series[time_col], dd_series["drawdown_relative_pct"], color=NEUTRAL, label="Relative DD (%)")
    ax2.set_ylabel("Relative drawdown (%)", color=NEUTRAL)
    ax2.tick_params(axis="y", labelcolor=NEUTRAL)

    fig.suptitle(f"Absolute vs relative drawdown — account {account_no}")
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return out_path
