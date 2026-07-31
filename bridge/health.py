from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from bridge.atomic_io import atomic_write_json, read_json

SCHEMA_VERSION = 1


@dataclass(frozen=True)
class LeaseFence:
    coordination_epoch: str
    fencing_token: int

    def to_dict(self) -> dict:
        return {
            "coordination_epoch": self.coordination_epoch,
            "fencing_token": self.fencing_token,
        }


@dataclass(frozen=True)
class QuarantineDetail:
    quarantined_at_utc: str
    quarantine_reason: str
    cleared_at_utc: str | None

    def to_dict(self) -> dict:
        return {
            "quarantined_at_utc": self.quarantined_at_utc,
            "quarantine_reason": self.quarantine_reason,
            "cleared_at_utc": self.cleared_at_utc,
        }


@dataclass(frozen=True)
class AccountHealth:
    schema_version: int
    profile_id: str
    login: int
    supervisor_instance_id: str
    state: str
    state_generation: int
    last_transition_reason: str
    last_transition_at_utc: str
    restart_count: int
    restart_count_window_start_utc: str
    last_successful_live_poll_utc: str | None
    last_successful_history_window_utc: str | None
    current_lease_fence: LeaseFence | None
    quarantine: QuarantineDetail | None
    outbox_quarantined_count: int = 0
    oldest_outbox_quarantined_at_utc: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "profile_id": self.profile_id,
            "login": self.login,
            "supervisor_instance_id": self.supervisor_instance_id,
            "state": self.state,
            "state_generation": self.state_generation,
            "last_transition_reason": self.last_transition_reason,
            "last_transition_at_utc": self.last_transition_at_utc,
            "restart_count": self.restart_count,
            "restart_count_window_start_utc": self.restart_count_window_start_utc,
            "last_successful_live_poll_utc": self.last_successful_live_poll_utc,
            "last_successful_history_window_utc": self.last_successful_history_window_utc,
            "current_lease_fence": (
                self.current_lease_fence.to_dict() if self.current_lease_fence else None
            ),
            "quarantine": self.quarantine.to_dict() if self.quarantine else None,
            "outbox_quarantined_count": self.outbox_quarantined_count,
            "oldest_outbox_quarantined_at_utc": self.oldest_outbox_quarantined_at_utc,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AccountHealth:
        fence_data = data.get("current_lease_fence")
        quarantine_data = data.get("quarantine")
        return cls(
            schema_version=data["schema_version"],
            profile_id=data["profile_id"],
            login=data["login"],
            supervisor_instance_id=data["supervisor_instance_id"],
            state=data["state"],
            state_generation=data["state_generation"],
            last_transition_reason=data["last_transition_reason"],
            last_transition_at_utc=data["last_transition_at_utc"],
            restart_count=data["restart_count"],
            restart_count_window_start_utc=data["restart_count_window_start_utc"],
            last_successful_live_poll_utc=data.get("last_successful_live_poll_utc"),
            last_successful_history_window_utc=data.get(
                "last_successful_history_window_utc"
            ),
            current_lease_fence=(
                LeaseFence(**fence_data) if fence_data is not None else None
            ),
            quarantine=(
                QuarantineDetail(**quarantine_data)
                if quarantine_data is not None
                else None
            ),
            outbox_quarantined_count=data.get("outbox_quarantined_count", 0),
            oldest_outbox_quarantined_at_utc=data.get(
                "oldest_outbox_quarantined_at_utc"
            ),
        )


class HealthStore:
    """Versioned, atomically-written per-account and supervisor-level health
    state under <state_dir>/health/. This is also the durable home of each
    account's restart-count/backoff-window bookkeeping (design decision:
    one durable per-account file, not two, since both update on the same
    event — a child exiting — and reading them separately risks drift). A
    supervisor restart resumes restart-count state from here rather than
    resetting every account back to zero.
    """

    def __init__(self, state_dir: str | Path) -> None:
        self._directory = Path(state_dir) / "health"

    def _account_path(self, profile_id: str) -> Path:
        return self._directory / f"{profile_id}.json"

    def _supervisor_path(self) -> Path:
        return self._directory / "supervisor.json"

    def load_account(self, profile_id: str) -> AccountHealth | None:
        data = read_json(self._account_path(profile_id))
        if data is None:
            return None
        return AccountHealth.from_dict(data)

    def get_restart_state(self, profile_id: str) -> tuple[int, str | None]:
        """Resume point for the restart-policy engine: (restart_count,
        restart_count_window_start_utc). Returns (0, None) for an account
        with no prior health record — a fresh start, not a resumed one."""
        record = self.load_account(profile_id)
        if record is None:
            return 0, None
        return record.restart_count, record.restart_count_window_start_utc

    def record_transition(
        self,
        *,
        profile_id: str,
        login: int,
        supervisor_instance_id: str,
        state: str,
        last_transition_reason: str,
        last_transition_at_utc: str,
        restart_count: int,
        restart_count_window_start_utc: str,
        last_successful_live_poll_utc: str | None = None,
        last_successful_history_window_utc: str | None = None,
        current_lease_fence: LeaseFence | None = None,
        quarantine: QuarantineDetail | None = None,
    ) -> AccountHealth:
        previous = self.load_account(profile_id)
        next_generation = (previous.state_generation + 1) if previous else 1
        # Preserve poll/history timestamps unless the caller explicitly
        # supplies a newer one -- a transition record (e.g. a restart-count
        # bump) should not blow away the last known successful poll time.
        if last_successful_live_poll_utc is None and previous is not None:
            last_successful_live_poll_utc = previous.last_successful_live_poll_utc
        if last_successful_history_window_utc is None and previous is not None:
            last_successful_history_window_utc = (
                previous.last_successful_history_window_utc
            )
        record = AccountHealth(
            schema_version=SCHEMA_VERSION,
            profile_id=profile_id,
            login=login,
            supervisor_instance_id=supervisor_instance_id,
            state=state,
            state_generation=next_generation,
            last_transition_reason=last_transition_reason,
            last_transition_at_utc=last_transition_at_utc,
            restart_count=restart_count,
            restart_count_window_start_utc=restart_count_window_start_utc,
            last_successful_live_poll_utc=last_successful_live_poll_utc,
            last_successful_history_window_utc=last_successful_history_window_utc,
            current_lease_fence=current_lease_fence,
            quarantine=quarantine,
        )
        atomic_write_json(self._account_path(profile_id), record.to_dict())
        return record

    def write_supervisor(
        self,
        *,
        supervisor_instance_id: str,
        started_at_utc: str,
        updated_at_utc: str,
        account_profile_ids: list[str],
    ) -> None:
        atomic_write_json(
            self._supervisor_path(),
            {
                "schema_version": SCHEMA_VERSION,
                "supervisor_instance_id": supervisor_instance_id,
                "started_at_utc": started_at_utc,
                "updated_at_utc": updated_at_utc,
                "accounts": account_profile_ids,
            },
        )

    def load_supervisor(self) -> dict[str, Any] | None:
        return read_json(self._supervisor_path())
