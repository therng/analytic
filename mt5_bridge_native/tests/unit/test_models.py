from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from mt5_bridge_native.errors import FailureClass, RedactedFailure
from mt5_bridge_native.models import CallState, HistoryWindowState, ProducerState


def test_state_enums_freeze_wire_values() -> None:
    assert CallState.SUCCESS_EMPTY.value == "success_empty"
    assert HistoryWindowState.OUTBOX_PENDING.value == "outbox_pending"
    assert ProducerState.QUARANTINED.value == "quarantined"
    assert FailureClass.UNEXPECTED_TERMINAL_LAUNCH.value == (
        "unexpected_terminal_launch"
    )


def test_redacted_failure_forbids_secret_shaped_details() -> None:
    with pytest.raises(ValidationError, match="secret-bearing field"):
        RedactedFailure(
            occurred_at_utc=datetime.now(UTC),
            failure_class=FailureClass.SECURITY,
            operation="redis.connect",
            details={"password": "secret"},
        )


def test_redacted_failure_requires_utc_observation_time() -> None:
    with pytest.raises(ValidationError, match="timezone-aware UTC"):
        RedactedFailure(
            occurred_at_utc=datetime(2026, 1, 1),
            failure_class=FailureClass.CONFIGURATION,
            operation="config.validate",
            details={},
        )
