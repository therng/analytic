from __future__ import annotations

import os
import sys
from pathlib import Path

from bridge.config import DEFAULT_HISTORY_LOWER_BOUND_RAW


def _ensure_windows_journal_acl(state_dir: Path) -> None:
    """journal/connection.py's _validate_windows_acl requires the journal
    dir's DACL to be protected (inheritance broken) and restricted to the
    service account SID, or every account quarantines with journal_failure
    even though the directory is real and readable. install-service.ps1
    applies this once at install time, but any process that recreates the
    journal dir at runtime (fresh host, reset-history, deleted state,
    nssm restart after a deletion) reinherits the parent ACL and silently
    reintroduces the bug until the next manual re-install. Reapply here on
    every start instead -- best-effort; _validate_windows_acl is the
    fail-closed backstop if this can't run (e.g. non-admin account)."""
    if os.name != "nt":
        return
    journal_dir = state_dir / "journal"
    journal_dir.mkdir(parents=True, exist_ok=True)
    account = os.environ.get("USERNAME", "")
    if not account:
        return
    import subprocess

    try:
        subprocess.run(
            ["icacls", str(journal_dir), "/inheritance:r", "/grant:r", f"{account}:(OI)(CI)F"],
            check=True,
            capture_output=True,
            timeout=10,
        )
        subprocess.run(
            ["icacls", str(journal_dir), "/setowner", account],
            check=True,
            capture_output=True,
            timeout=10,
        )
    except Exception as exc:  # noqa: BLE001 - best-effort, validator backstops it
        print(f"warning: journal ACL self-heal failed: {exc}", file=sys.stderr)


def main() -> int:
    """`python -m bridge` -- the operator-facing entrypoint. Takes no
    per-account arguments: the account list comes from auto-discovery
    (bridge/discovery.py, design doc §12), never from a manually
    enumerated flag or file the operator must maintain."""
    from bridge.adapters.mt5_real import RealMt5Port
    from bridge.adapters.process_probe_psutil import RealProcessProbe
    from bridge.supervisor import Supervisor, SupervisorConfig

    # Every worker child re-reads REDIS_URL independently and exits
    # CONFIG_INVALID if it's unset -- checking it once here, loudly, before
    # any child spawns, turns "N accounts silently quarantined" into one
    # visible startup failure.
    if not os.environ.get("REDIS_URL"):
        print("REDIS_URL is required", file=sys.stderr)
        return 1

    state_dir = Path(os.environ.get("BRIDGE_STATE_DIR", "bridge/state"))
    _ensure_windows_journal_acl(state_dir)
    config = SupervisorConfig(
        overrides_dir=Path(os.environ.get("BRIDGE_ACCOUNTS_DIR", "bridge/accounts")),
        generated_dir=state_dir / "discovered-accounts",
        state_dir=state_dir,
        state_dir_windows=os.environ.get(
            "BRIDGE_STATE_DIR_WINDOWS", "C:\\analytic\\bridge\\state"
        ),
        tick_interval_s=float(os.environ.get("BRIDGE_SUPERVISOR_TICK_S", "5")),
        discovery_rescan_s=float(os.environ.get("BRIDGE_DISCOVERY_RESCAN_S", "30")),
        ctrl_break_wait_s=int(os.environ.get("BRIDGE_CTRL_BREAK_WAIT_MS", "2000")) / 1000,
        shutdown_grace_s=int(os.environ.get("BRIDGE_SHUTDOWN_GRACE_MS", "15000")) / 1000,
        shutdown_kill_grace_s=int(os.environ.get("BRIDGE_SHUTDOWN_KILL_GRACE_MS", "5000"))
        / 1000,
        max_history_skew_s=int(os.environ.get("BRIDGE_HISTORY_LOWER_BOUND_MAX_SKEW_S", "86400")),
        history_lower_bound_raw=int(
            os.environ.get(
                "BRIDGE_HISTORY_LOWER_BOUND_RAW",
                str(DEFAULT_HISTORY_LOWER_BOUND_RAW),
            )
        ),
    )

    supervisor = Supervisor(
        config=config,
        process_lister=RealProcessProbe(),
        mt5_factory=RealMt5Port,
    )

    import signal

    def handle_signal(signum: int, frame: object) -> None:
        del signum, frame
        supervisor.request_stop()

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    try:
        supervisor.run()
    finally:
        supervisor.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
