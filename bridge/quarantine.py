from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from bridge.atomic_io import atomic_write_json, read_json

SCHEMA_VERSION = 1


@dataclass(frozen=True)
class QuarantineRecord:
    schema_version: int
    profile_id: str
    login: int
    quarantined_at_utc: str
    quarantine_reason: str
    triggering_exit_code: int | None
    restart_count_at_quarantine: int
    cleared_at_utc: str | None
    cleared_by: str | None
    quarantine_detail: str | None = None

    @property
    def is_active(self) -> bool:
        return self.cleared_at_utc is None

    def to_dict(self) -> dict:
        return {
            "schema_version": self.schema_version,
            "profile_id": self.profile_id,
            "login": self.login,
            "quarantined_at_utc": self.quarantined_at_utc,
            "quarantine_reason": self.quarantine_reason,
            "quarantine_detail": self.quarantine_detail,
            "triggering_exit_code": self.triggering_exit_code,
            "restart_count_at_quarantine": self.restart_count_at_quarantine,
            "cleared_at_utc": self.cleared_at_utc,
            "cleared_by": self.cleared_by,
        }

    @classmethod
    def from_dict(cls, data: dict) -> QuarantineRecord:
        return cls(
            schema_version=data["schema_version"],
            profile_id=data["profile_id"],
            login=data["login"],
            quarantined_at_utc=data["quarantined_at_utc"],
            quarantine_reason=data["quarantine_reason"],
            quarantine_detail=data.get("quarantine_detail"),
            triggering_exit_code=data.get("triggering_exit_code"),
            restart_count_at_quarantine=data["restart_count_at_quarantine"],
            cleared_at_utc=data.get("cleared_at_utc"),
            cleared_by=data.get("cleared_by"),
        )


class QuarantineStore:
    """Durable, file-backed per-account quarantine state under
    <state_dir>/quarantine/<profile_id>.json. Survives a supervisor/NSSM
    restart by construction: it is loaded fresh from disk, not carried in
    supervisor process memory. Clearing quarantine (`clear`) is the only
    sanctioned in-process way to make an account eligible to spawn again
    short of it never having been quarantined at all — restarting the whole
    supervisor process does not, by itself, clear anything here.
    """

    def __init__(self, state_dir: str | Path) -> None:
        self._directory = Path(state_dir) / "quarantine"

    def _path_for(self, profile_id: str) -> Path:
        return self._directory / f"{profile_id}.json"

    def get(self, profile_id: str) -> QuarantineRecord | None:
        data = read_json(self._path_for(profile_id))
        if data is None:
            return None
        return QuarantineRecord.from_dict(data)

    def is_quarantined(self, profile_id: str) -> bool:
        record = self.get(profile_id)
        return record is not None and record.is_active

    def quarantine(
        self,
        *,
        profile_id: str,
        login: int,
        reason: str,
        triggering_exit_code: int | None,
        restart_count_at_quarantine: int,
        detail: str | None = None,
    ) -> QuarantineRecord:
        record = QuarantineRecord(
            schema_version=SCHEMA_VERSION,
            profile_id=profile_id,
            login=login,
            quarantined_at_utc=datetime.now(UTC).isoformat(),
            quarantine_reason=reason,
            quarantine_detail=detail,
            triggering_exit_code=triggering_exit_code,
            restart_count_at_quarantine=restart_count_at_quarantine,
            cleared_at_utc=None,
            cleared_by=None,
        )
        atomic_write_json(self._path_for(profile_id), record.to_dict())
        return record

    def clear(self, profile_id: str, *, operator: str) -> QuarantineRecord:
        """The unquarantine operation. Requires an existing quarantine
        record — clearing an account that was never quarantined is a no-op
        error, not a silent success, so an operator gets clear feedback if
        they targeted the wrong profile_id/login."""
        existing = self.get(profile_id)
        if existing is None:
            raise LookupError(f"no quarantine record for profile_id={profile_id!r}")
        cleared = QuarantineRecord(
            schema_version=existing.schema_version,
            profile_id=existing.profile_id,
            login=existing.login,
            quarantined_at_utc=existing.quarantined_at_utc,
            quarantine_reason=existing.quarantine_reason,
            quarantine_detail=existing.quarantine_detail,
            triggering_exit_code=existing.triggering_exit_code,
            restart_count_at_quarantine=existing.restart_count_at_quarantine,
            cleared_at_utc=datetime.now(UTC).isoformat(),
            cleared_by=operator,
        )
        atomic_write_json(self._path_for(profile_id), cleared.to_dict())
        return cleared

    def list_active(self) -> list[QuarantineRecord]:
        if not self._directory.is_dir():
            return []
        records = []
        for path in sorted(self._directory.glob("*.json")):
            data = read_json(path)
            if data is None:
                continue
            record = QuarantineRecord.from_dict(data)
            if record.is_active:
                records.append(record)
        return records
