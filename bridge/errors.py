from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class FailureClass(StrEnum):
    CONFIGURATION = "configuration"
    PREFLIGHT_IDENTITY = "preflight_identity"
    UNEXPECTED_TERMINAL_LAUNCH = "unexpected_terminal_launch"
    IDENTITY_DRIFT = "identity_drift"
    OWNERSHIP = "ownership"
    COORDINATION_RESET = "coordination_reset"
    MT5_TRANSIENT = "mt5_transient"
    MT5_AUTH = "mt5_auth"
    MT5_PERMANENT = "mt5_permanent"
    MT5_EMPTY = "mt5_empty"
    SERIALIZATION = "serialization"
    JOURNAL_LOCKED = "journal_locked"
    JOURNAL_CORRUPT = "journal_corrupt"
    JOURNAL_INCOMPATIBLE = "journal_incompatible"
    REDIS_TRANSIENT = "redis_transient"
    REDIS_PERMANENT = "redis_permanent"
    SECURITY = "security"


_SECRET_PARTS = (
    "password",
    "passwd",
    "secret",
    "token",
    "credential",
    "connection_string",
    "redis_url",
)


def _contains_secret_field(value: Any) -> bool:
    if isinstance(value, dict):
        return any(
            any(part in str(key).casefold() for part in _SECRET_PARTS)
            or _contains_secret_field(nested)
            for key, nested in value.items()
        )
    if isinstance(value, (list, tuple)):
        return any(_contains_secret_field(item) for item in value)
    return False


class RedactedFailure(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    occurred_at_utc: datetime
    failure_class: FailureClass
    operation: str = Field(min_length=1)
    details: dict[str, Any]

    @model_validator(mode="after")
    def validate_redaction(self) -> Self:
        if self.occurred_at_utc.tzinfo is None:
            raise ValueError("occurred_at_utc must be timezone-aware UTC")
        if self.occurred_at_utc.utcoffset() != UTC.utcoffset(self.occurred_at_utc):
            raise ValueError("occurred_at_utc must be timezone-aware UTC")
        if _contains_secret_field(self.details):
            raise ValueError("details contain a secret-bearing field")
        return self
