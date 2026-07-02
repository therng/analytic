"""
Formulas mirroring src/lib/trading/analytics.ts so Python results match the dashboard.
"""

import pandas as pd


def compute_mae_mfe(positions: pd.DataFrame, excursions: pd.DataFrame) -> pd.DataFrame:
    """
    Per-position Maximum Adverse / Favorable Excursion, derived from PositionExcursion
    samples (profit sampled every 60s while the position was open).

    MAE = worst unrealized loss reached while open (<= 0)
    MFE = best unrealized gain reached while open (>= 0)

    Resolution is 60s, so this approximates true tick-level MAE/MFE — good enough for
    swing/grid-style EAs, coarse for scalpers with sub-minute holds.
    """
    if excursions.empty:
        out = positions.copy()
        out["mae"] = None
        out["mfe"] = None
        return out

    agg = excursions.groupby("position_ticket")["profit"].agg(
        mae=lambda s: min(0.0, s.min()),
        mfe=lambda s: max(0.0, s.max()),
    )
    return positions.merge(
        agg, left_on="position_no", right_index=True, how="left"
    )


def compute_balance_drawdown(equity_history: pd.DataFrame, value_col: str = "balance") -> dict:
    """
    Mirrors computeBalanceDrawdown() in analytics.ts. MT5 distinguishes:
      - absoluteAmount:  max(0, totalDeposits - minimalBalance) — how far below the
                         initial deposit the balance ever fell (needs deposit total;
                         pass via total_deposits if available, else approximated as
                         the first value in the series).
      - maximalAmount/%: the single peak-to-trough drawdown instance with the largest $ amount.
      - relativeAmount/%: the single peak-to-trough drawdown instance with the largest %
                          — MT5's "Relative Drawdown" can be a *different* instance than
                          the maximal-amount one (e.g. a small-peak, large-% dip).
    """
    series = equity_history[value_col].astype(float).tolist()
    if not series:
        return {
            "minimalBalance": 0.0, "maximalAmount": 0.0, "maximalPercent": 0.0,
            "relativeAmount": 0.0, "relativePercent": 0.0,
            "peakBalance": 0.0, "troughBalance": 0.0,
        }

    start = series[0]
    peak = start
    minimal = start
    max_amt = max_pct = rel_amt = rel_pct = 0.0
    peak_bal = trough_bal = start

    for value in series:
        minimal = min(minimal, value)
        peak = max(peak, value)
        dd_amt = peak - value
        dd_pct = (dd_amt / peak * 100) if peak > 0 else 0.0

        if dd_amt > max_amt or (dd_amt == max_amt and dd_pct > max_pct):
            max_amt, max_pct, peak_bal, trough_bal = dd_amt, dd_pct, peak, value
        if dd_pct > rel_pct or (dd_pct == rel_pct and dd_amt > rel_amt):
            rel_amt, rel_pct = dd_amt, dd_pct

    return {
        "minimalBalance": minimal,
        "maximalAmount": max_amt, "maximalPercent": max_pct,
        "relativeAmount": rel_amt, "relativePercent": rel_pct,
        "peakBalance": peak_bal, "troughBalance": trough_bal,
    }


def build_drawdown_series(equity_history: pd.DataFrame, value_col: str = "balance") -> pd.DataFrame:
    """Running high-water-mark drawdown series: absolute ($) and relative (%) per point."""
    df = equity_history.copy()
    df["hwm"] = df[value_col].astype(float).cummax()
    df["drawdown_absolute"] = df["hwm"] - df[value_col].astype(float)
    df["drawdown_relative_pct"] = (df["drawdown_absolute"] / df["hwm"].replace(0, pd.NA)) * 100
    return df
