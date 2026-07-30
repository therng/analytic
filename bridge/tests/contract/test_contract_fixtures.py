from __future__ import annotations

import json
from pathlib import Path

import pytest

from bridge.canonical import canonical_json_bytes, sha256_hex
from bridge.models import BridgeEnvelope

FIXTURE_DIR = Path(__file__).parent
FIXTURES = (
    "envelope-v1.json",
    "history-deal-v1.json",
    "history-order-v1.json",
    "history-window-v1.json",
)


@pytest.mark.parametrize("fixture_name", FIXTURES)
def test_contract_fixture_is_valid_canonicalizable_and_secret_free(
    fixture_name: str,
) -> None:
    raw = (FIXTURE_DIR / fixture_name).read_text(encoding="utf-8")
    envelope = BridgeEnvelope.model_validate_json(raw)
    dumped = envelope.model_dump(mode="json")

    assert canonical_json_bytes(dumped)
    assert envelope.event_time_semantic == "mt5-broker-server-raw"
    assert not {"password", "redis_url", "token"} & set(raw.casefold().split('"'))


def test_deal_fixture_preserves_raw_time_and_payload_digest() -> None:
    data = json.loads((FIXTURE_DIR / "history-deal-v1.json").read_text())
    envelope = BridgeEnvelope.model_validate(data)

    assert envelope.payload["raw"]["time"] == 1_735_689_600
    assert envelope.payload["raw"]["time_msc"] == 1_735_689_600_123
    assert envelope.payload_digest == sha256_hex(canonical_json_bytes(envelope.payload))


def test_window_fixture_can_publish_empty_coverage() -> None:
    envelope = BridgeEnvelope.model_validate_json(
        (FIXTURE_DIR / "history-window-v1.json").read_text()
    )

    assert envelope.message_type == "history.window"
    assert envelope.payload["deal_count"] == 0
    assert envelope.payload["order_count"] == 0
    assert envelope.payload["ordered_event_ids"] == []
