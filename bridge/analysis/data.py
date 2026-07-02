"""
Loaders for the analytic Postgres database.

Reads the same tables the Next.js app writes (see prisma/schema.prisma):
  Account            — accountNo -> internal id
  Position           — closed positions, realized P/L (source of truth for win rate / PF)
  PositionExcursion  — 60s profit samples per open position (source for MAE/MFE)
  EquityHistory      — per-report equity/balance snapshots (source for drawdown)

Set DATABASE_URL in bridge/analysis/.env (same connection string as the Next.js app).
"""

import os

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL")


def get_engine():
    if not DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL not set. Add it to bridge/analysis/.env "
            "(same value as the Next.js app's .env)."
        )
    return create_engine(DATABASE_URL)


def _account_id(engine, account_no: str) -> str:
    with engine.connect() as conn:
        row = conn.execute(
            text('SELECT id FROM "Account" WHERE account_number = :account_no'),
            {"account_no": account_no},
        ).fetchone()
    if row is None:
        raise ValueError(f"No account found with account_number={account_no!r}")
    return row[0]


def load_positions(account_no: str, engine=None) -> pd.DataFrame:
    """Closed positions with realized P/L. `net_pnl` = profit + swap + commission (CLAUDE.md convention)."""
    engine = engine or get_engine()
    account_id = _account_id(engine, account_no)
    df = pd.read_sql(
        text(
            """
            SELECT position_no, symbol, type, volume,
                   open_time, open_price, close_time, close_price,
                   commission, swap, profit, comment
            FROM "Position"
            WHERE account_id = :account_id
            ORDER BY close_time
            """
        ),
        engine,
        params={"account_id": account_id},
    )
    for col in ("commission", "swap", "profit"):
        df[col] = df[col].astype(float)
    df["net_pnl"] = df["profit"] + df["swap"] + df["commission"]
    return df


def load_position_excursions(account_no: str, engine=None) -> pd.DataFrame:
    """60s profit samples per open position — approximates tick-level MAE/MFE."""
    engine = engine or get_engine()
    account_id = _account_id(engine, account_no)
    df = pd.read_sql(
        text(
            """
            SELECT position_ticket, ts, profit
            FROM "PositionExcursion"
            WHERE account_id = :account_id
            ORDER BY position_ticket, ts
            """
        ),
        engine,
        params={"account_id": account_id},
    )
    df["profit"] = df["profit"].astype(float)
    return df


def load_equity_history(account_no: str, engine=None) -> pd.DataFrame:
    """Per-report equity/balance snapshots — source for drawdown curves."""
    engine = engine or get_engine()
    account_id = _account_id(engine, account_no)
    df = pd.read_sql(
        text(
            """
            SELECT report_date, equity, balance, floating_pl, margin
            FROM "EquityHistory"
            WHERE account_id = :account_id
            ORDER BY report_date
            """
        ),
        engine,
        params={"account_id": account_id},
    )
    for col in ("equity", "balance", "floating_pl", "margin"):
        df[col] = df[col].astype(float)
    return df
