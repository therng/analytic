from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Protocol

from bridge.redis_transport import FenceCredential, RedisLease


class PublishedOutboxReplayError(RuntimeError):
    pass


class ReplayTarget(Protocol):
    def get(self, key: str) -> bytes | None: ...

    def set(
        self, key: str, value: bytes, *, nx: bool = False, px: int | None = None
    ) -> bool: ...

    def xadd(self, stream: str, fields: dict[str, str | bytes]) -> str: ...


@dataclass(frozen=True)
class PublishedOutboxMessage:
    event_id: str
    envelope: bytes


@dataclass(frozen=True)
class PublishedOutboxReplayResult:
    published_count: int


class FencedReplayTarget:
    """Uses a normal bridge lease for replay publication and target markers."""

    def __init__(
        self, raw_target: ReplayTarget, lease: RedisLease, credential: FenceCredential
    ) -> None:
        self._raw_target = raw_target
        self._lease = lease
        self._credential = credential

    def get(self, key: str) -> bytes | None:
        return self._raw_target.get(key)

    def set(
        self, key: str, value: bytes, *, nx: bool = False, px: int | None = None
    ) -> bool:
        return self._raw_target.set(key, value, nx=nx, px=px)

    def xadd(self, stream: str, fields: dict[str, str | bytes]) -> str:
        if stream != RedisLease.cluster_keys(self._credential.login)[4]:
            raise PublishedOutboxReplayError("replay stream does not match lease login")
        event_id = fields.get("event_id")
        envelope = fields.get("envelope")
        if not isinstance(event_id, str) or not isinstance(envelope, bytes):
            raise PublishedOutboxReplayError("replay append fields are invalid")
        return self._lease.append_stream_fenced(self._credential, event_id, envelope)


class PublishedOutboxReplay:
    """Read immutable published history envelopes from one native journal."""

    def __init__(self, journal_path: Path, *, login: int) -> None:
        if login <= 0:
            raise ValueError("login must be positive")
        self._journal_path = journal_path.resolve()
        self._login = login

    def read_messages(self) -> tuple[PublishedOutboxMessage, ...]:
        expected_stream = RedisLease.cluster_keys(self._login)[4]
        source_uri = f"{self._journal_path.as_uri()}?mode=ro"
        with sqlite3.connect(source_uri, uri=True) as connection:
            connection.execute("PRAGMA query_only = ON")
            rows = connection.execute(
                "SELECT outbox.event_id, outbox.envelope_json, outbox.stream_key, "
                "windows.start_raw, outbox.rowid "
                "FROM outbox_messages AS outbox "
                "JOIN producer_profiles AS profiles ON profiles.profile_id = outbox.profile_id "
                "JOIN history_windows AS windows "
                "ON windows.window_id = outbox.window_id AND windows.profile_id = outbox.profile_id "
                "WHERE profiles.login = ? AND outbox.state = 'PUBLISHED'",
                (self._login,),
            ).fetchall()

        parsed: list[tuple[int, int, int, PublishedOutboxMessage]] = []
        for event_id, envelope, stream_key, start_raw, rowid in rows:
            if stream_key != expected_stream:
                raise PublishedOutboxReplayError("published outbox stream does not match login")
            message = self._message(event_id, envelope)
            message_type = self._message_type(message.envelope)
            parsed.append(
                (
                    int(start_raw),
                    1 if message_type == "history.window" else 0,
                    int(rowid),
                    message,
                )
            )
        parsed.sort(key=lambda item: item[:3])
        return tuple(item[3] for item in parsed)

    def replay(
        self, target: ReplayTarget, *, target_id: str
    ) -> PublishedOutboxReplayResult:
        self._validate_target_id(target_id)
        messages = self.read_messages()
        if not messages:
            return PublishedOutboxReplayResult(published_count=0)
        marker_key = self._marker_key(target_id)
        if target.get(marker_key) is not None:
            raise PublishedOutboxReplayError("published outbox replay already completed for target")
        if not target.set(f"{marker_key}:lock", b"in-progress", nx=True, px=900_000):
            raise PublishedOutboxReplayError("published outbox recovery lock is unavailable")
        stream_key = RedisLease.cluster_keys(self._login)[4]
        for message in messages:
            target.xadd(stream_key, {"event_id": message.event_id, "envelope": message.envelope})
        if not target.set(marker_key, b"complete", nx=True):
            raise PublishedOutboxReplayError("published outbox replay marker already exists")
        return PublishedOutboxReplayResult(published_count=len(messages))

    def _marker_key(self, target_id: str) -> str:
        source_id = sha256(str(self._journal_path).encode()).hexdigest()[:16]
        return (
            f"mt5:account:{{{self._login}}}:recovery:published-outbox:"
            f"{target_id}:{source_id}"
        )

    @staticmethod
    def _validate_target_id(target_id: str) -> None:
        allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"
        if not target_id or any(character not in allowed for character in target_id):
            raise ValueError("target_id must contain only letters, digits, dot, underscore, or hyphen")

    @staticmethod
    def _message(event_id: object, envelope: object) -> PublishedOutboxMessage:
        if not isinstance(event_id, str) or not event_id:
            raise PublishedOutboxReplayError("published outbox event_id is invalid")
        if not isinstance(envelope, bytes) or not envelope:
            raise PublishedOutboxReplayError("published outbox envelope is invalid")
        return PublishedOutboxMessage(event_id=event_id, envelope=envelope)

    @staticmethod
    def _message_type(envelope: bytes) -> str:
        try:
            decoded = json.loads(envelope)
        except (TypeError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise PublishedOutboxReplayError("published outbox envelope is not valid JSON") from error
        message_type = decoded.get("message_type") if isinstance(decoded, dict) else None
        if message_type not in {"history.deal", "history.order", "history.window"}:
            raise PublishedOutboxReplayError("published outbox message_type is unsupported")
        return message_type
