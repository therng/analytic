"""Serialization + time conversion + Decimal safety."""

from collections import namedtuple
from decimal import Decimal

from bridge_v2.serializers import record_to_dict, serialize_record, to_decimal

# Mimics an MT5 namedtuple record.
Deal = namedtuple("Deal", "ticket order position_id symbol type entry volume price commission fee swap profit time time_msc comment")


def make_deal(**over):
    base = dict(
        ticket=1, order=10, position_id=101, symbol="EURUSD", type=0, entry=0,
        volume=0.1, price=1.1, commission=-0.7, fee=0.0, swap=0.0, profit=12.34,
        time=1_767_225_600, time_msc=1_767_225_600_123, comment="tp",
    )
    base.update(over)
    return Deal(**base)


def test_asdict_preserves_every_mt5_field():
    d = make_deal()
    row = record_to_dict(d)
    assert set(row) == set(Deal._fields)
    assert row["comment"] == "tp"
    assert row["position_id"] == 101


def test_serialize_adds_iso_mirror_without_dropping_raw_epoch():
    row = serialize_record(make_deal())
    # Raw epoch is preserved verbatim...
    assert row["time"] == 1_767_225_600
    assert row["time_msc"] == 1_767_225_600_123
    # ...and mirrored as an ISO string for the same UTC instant.
    assert row["time_iso"] == "2026-01-01T00:00:00+00:00"
    assert row["time_msc_iso"].startswith("2026-01-01T00:00:00.123")


def test_zero_time_fields_get_no_iso_mirror():
    row = serialize_record(make_deal(time=0, time_msc=0))
    assert "time_iso" not in row
    assert "time_msc_iso" not in row


def test_to_decimal_never_routes_through_binary_float():
    # 0.1 + 0.2 as floats == 0.30000000000000004; via Decimal-from-str it is exact.
    assert to_decimal("0.1") + to_decimal("0.2") == Decimal("0.3")
    assert to_decimal(None) == Decimal("0")
    assert to_decimal("") == Decimal("0")
