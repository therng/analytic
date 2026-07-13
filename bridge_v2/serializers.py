"""Raw MT5 record -> JSON-safe dict, with NO field loss.

Rules:
  * namedtuple records are converted via _asdict() so every MT5 field survives.
  * Time fields keep BOTH the raw epoch and a normalized UTC ISO string.
  * Money uses Decimal built from str() — never Python float — for any
    reconciliation math (see reconcile.py). Serialized JSON keeps the raw
    numeric value so nothing is rounded on the wire.

Time interpretation (documented, not inferred):
  MT5 `.time`, `.time_setup`, `.time_done`, `.time_msc` are epoch integers in
  the BROKER SERVER timezone, expressed as if they were Unix seconds/ms. We do
  NOT apply the broker UTC offset here — that conversion happens exactly once in
  the Node worker (serverTimeToUtc). Here we only:
    - keep the raw epoch verbatim (`<field>` unchanged)
    - add `<field>_iso`: the same epoch rendered as an ISO string WITHOUT any
      offset applied (i.e. server-clock-as-UTC). This is a human-readable mirror
      of the raw value, explicitly labelled, not a timezone-corrected time.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

# Fields that are epoch seconds on MT5 records.
_TIME_SECOND_FIELDS = ("time", "time_setup", "time_done", "time_update", "time_expiration")
# Fields that are epoch milliseconds.
_TIME_MSC_FIELDS = ("time_msc", "time_setup_msc", "time_done_msc", "time_update_msc")

# Money fields to expose as Decimal-safe strings for reconciliation.
MONEY_FIELDS = ("profit", "commission", "fee", "swap", "price", "price_open", "price_current", "volume")


def record_to_dict(record) -> dict:
    """Convert one MT5 namedtuple record to a plain dict, preserving every field."""
    if hasattr(record, "_asdict"):
        return dict(record._asdict())
    if isinstance(record, dict):
        return dict(record)
    # SimpleNamespace / arbitrary object fallback.
    return dict(vars(record))


def _epoch_seconds_to_iso(epoch: int | float) -> str:
    """Render a raw server epoch as an ISO string with NO offset applied."""
    return datetime.fromtimestamp(int(epoch), tz=timezone.utc).isoformat()


def _epoch_msc_to_iso(msc: int | float) -> str:
    return datetime.fromtimestamp(int(msc) / 1000.0, tz=timezone.utc).isoformat()


def annotate_times(row: dict) -> dict:
    """Add `<field>_iso` mirrors for every time field present. Non-destructive."""
    out = dict(row)
    for field in _TIME_SECOND_FIELDS:
        val = row.get(field)
        if isinstance(val, (int, float)) and val:
            out[f"{field}_iso"] = _epoch_seconds_to_iso(val)
    for field in _TIME_MSC_FIELDS:
        val = row.get(field)
        if isinstance(val, (int, float)) and val:
            out[f"{field}_iso"] = _epoch_msc_to_iso(val)
    return out


def serialize_record(record) -> dict:
    """Full raw serialization: preserve all fields + add ISO time mirrors."""
    return annotate_times(record_to_dict(record))


def to_decimal(value) -> Decimal:
    """Decimal from str() — the only safe path for monetary reconciliation.

    None/"" -> Decimal("0"). Never routes through binary float.
    """
    if value is None or value == "":
        return Decimal("0")
    return Decimal(str(value))
