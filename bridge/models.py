from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from bridge.canonical import canonical_json_bytes, sha256_hex


class CallState(StrEnum):
    SUCCESS_NONEMPTY = "success_nonempty"
    SUCCESS_EMPTY = "success_empty"
    FAILED = "failed"


class ProducerState(StrEnum):
    STARTING = "starting"
    JOURNAL_READY = "journal_ready"
    PREFLIGHT = "preflight"
    ACQUIRING_OWNERSHIP = "acquiring_ownership"
    CONNECTING = "connecting"
    VERIFYING_IDENTITY = "verifying_identity"
    OWNED_READY = "owned_ready"
    RUNNING = "running"
    DEGRADED = "degraded"
    STANDBY_DUPLICATE = "standby_duplicate"
    QUARANTINED = "quarantined"
    DRAINING = "draining"
    STOPPED = "stopped"


class HistoryWindowState(StrEnum):
    PLANNED = "planned"
    READING_DEALS = "reading_deals"
    READING_ORDERS = "reading_orders"
    VALIDATING = "validating"
    SQLITE_TRANSACTION = "sqlite_transaction"
    COMMITTED = "committed"
    OUTBOX_PENDING = "outbox_pending"
    PUBLISHING = "publishing"
    PUBLISHED = "published"
    SUPERSEDED = "superseded"


class ProducerIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    producer_id: str = Field(min_length=1)
    profile_id: str = Field(min_length=1)
    epoch_id: str = Field(min_length=1)
    coordination_epoch: str = Field(min_length=1)
    fencing_token: int = Field(ge=1)


class TerminalIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    terminal_id: str = Field(min_length=1)
    portable: bool
    path_digest: str = Field(min_length=1)
    data_path_digest: str = Field(min_length=1)


class AccountIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    login: int = Field(gt=0)
    server: str = Field(min_length=1)


class BridgeEnvelope(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        populate_by_name=True,
        serialize_by_alias=True,
    )

    schema_id: Literal["mt5n.bridge.v1"] = Field(alias="schema")
    message_type: Literal[
        "live.snapshot",
        "live.error",
        "history.deal",
        "history.order",
        "history.window",
        "health",
        "producer.quarantined",
    ]
    event_id: str = Field(min_length=1)
    payload_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    producer: ProducerIdentity
    terminal: TerminalIdentity
    account: AccountIdentity
    observed_at_utc: datetime
    event_time_semantic: Literal["mt5-broker-server-raw"]
    payload_state: Literal["complete", "empty", "failed"]
    payload: dict[str, Any]

    @model_validator(mode="after")
    def validate_contract(self) -> Self:
        if self.observed_at_utc.tzinfo is None or self.observed_at_utc.utcoffset() != (
            UTC.utcoffset(self.observed_at_utc)
        ):
            raise ValueError("observed_at_utc must be timezone-aware UTC")
        actual_digest = sha256_hex(canonical_json_bytes(self.payload))
        if actual_digest != self.payload_digest:
            raise ValueError("payload_digest does not match canonical payload")
        return self
