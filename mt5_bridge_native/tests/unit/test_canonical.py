from __future__ import annotations

import math

import pytest
from hypothesis import given
from hypothesis import strategies as st

from mt5_bridge_native.canonical import (
    canonical_json_bytes,
    history_window_id,
    record_event_id,
    sha256_hex,
)


def test_canonical_json_is_sorted_compact_utf8_without_time_conversion() -> None:
    payload = {
        "time": 1_735_689_600,
        "symbol": "ทองคำ",
        "ticket": 42,
        "nested": {"z": None, "a": True},
    }

    assert canonical_json_bytes(payload) == (
        b'{"nested":{"a":true,"z":null},"symbol":"'
        + "ทองคำ".encode()
        + b'","ticket":42,"time":1735689600}'
    )


@given(st.dictionaries(st.text(min_size=1), st.integers(), max_size=12))
def test_mapping_insertion_order_never_changes_canonical_bytes(
    value: dict[str, int],
) -> None:
    assert canonical_json_bytes(value) == canonical_json_bytes(
        dict(reversed(list(value.items())))
    )


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_non_finite_floats_are_rejected(value: float) -> None:
    with pytest.raises(ValueError, match="finite"):
        canonical_json_bytes({"value": value})


def test_implicit_datetime_and_non_string_keys_are_rejected() -> None:
    with pytest.raises(TypeError, match="unsupported canonical value"):
        canonical_json_bytes({"observed": object()})

    with pytest.raises(TypeError, match="mapping keys must be strings"):
        canonical_json_bytes({1: "not allowed"})


def test_sha256_and_record_event_id_are_frozen() -> None:
    assert sha256_hex(b"abc") == (
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    )
    assert (
        record_event_id(
            namespace="mt5n",
            schema_version="v1",
            resource="deal",
            natural_identity="profile:10001:Broker:42",
            payload_digest="abc",
        )
        == "4912aa4390b30c614c53d2bba31ef75e94166d1ac36470cc910384b4d59fd66e"
    )


def test_history_window_revision_changes_identity_without_changing_raw_bounds() -> None:
    first = history_window_id(
        profile_id="profile",
        generation=1,
        start_raw=100,
        end_raw=200,
        policy_version=1,
        window_revision=1,
    )
    correction = history_window_id(
        profile_id="profile",
        generation=1,
        start_raw=100,
        end_raw=200,
        policy_version=1,
        window_revision=2,
    )

    assert first != correction
    assert first == history_window_id(
        profile_id="profile",
        generation=1,
        start_raw=100,
        end_raw=200,
        policy_version=1,
        window_revision=1,
    )
