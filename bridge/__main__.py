from __future__ import annotations

import os
import sys
from pathlib import Path


def main() -> int:
    """`python -m bridge` -- the operator-facing entrypoint. Takes no
    per-account arguments: the account list comes from auto-discovery
    (bridge/discovery.py, design doc §12), never from a manually
    enumerated flag or file the operator must maintain."""
    from bridge.adapters.mt5_real import RealMt5Port
    from bridge.adapters.process_probe_psutil import RealProcessProbe
    from bridge.supervisor import Supervisor, SupervisorConfig

    state_dir = Path(os.environ.get("BRIDGE_STATE_DIR", "bridge/state"))
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
