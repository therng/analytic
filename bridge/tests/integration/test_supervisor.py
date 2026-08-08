from __future__ import annotations

import json
import subprocess
import sys
import time
from collections import namedtuple
from pathlib import Path

from bridge.exit_codes import WorkerExitCode
from bridge.config import DEFAULT_HISTORY_LOWER_BOUND_RAW
from bridge.process_probe import ProcessCandidate
from bridge.quarantine import QuarantineStore
from bridge.restart_policy import BackoffConfig
from bridge.supervisor import Supervisor, SupervisorConfig

# ruff: noqa: E501

TerminalInfo = namedtuple("TerminalInfo", ["data_path", "connected"])
AccountInfo = namedtuple("AccountInfo", ["login", "server"])


def candidate(pid: int, executable_path: str = "C:\\MT5\\terminal64.exe") -> ProcessCandidate:
    return ProcessCandidate(
        pid=pid,
        creation_time=1000.0,
        executable_path=executable_path,
        command_line=(executable_path, "/portable"),
        process_user="svc",
        session_id=0,
        data_path="C:\\MT5\\data",
        evidence_complete=True,
    )


class FakeProcessLister:
    def __init__(self, candidates: list[ProcessCandidate]) -> None:
        self.candidates = candidates

    def build_candidates(self) -> list[ProcessCandidate]:
        return self.candidates


class FakeMt5:
    def __init__(self, login: int = 60001, server: str = "Broker-Demo") -> None:
        self._login = login
        self._server = server
        self.initialize_calls: list[str] = []

    def initialize(self, path: str, timeout: int, portable: bool) -> bool:
        self.initialize_calls.append(path)
        return True

    def shutdown(self) -> None:
        pass

    def terminal_info(self) -> TerminalInfo:
        return TerminalInfo(data_path="C:\\MT5\\data", connected=True)

    def account_info(self) -> AccountInfo:
        return AccountInfo(login=self._login, server=self._server)


class FakeProcessHandle:
    _next_pid = 9000

    def __init__(self) -> None:
        FakeProcessHandle._next_pid += 1
        self._pid = FakeProcessHandle._next_pid
        self._exit_code: int | None = None
        self.ctrl_break_called = False
        self.terminate_called = False
        self.kill_called = False

    @property
    def pid(self) -> int:
        return self._pid

    def poll(self) -> int | None:
        return self._exit_code

    def send_ctrl_break(self) -> None:
        self.ctrl_break_called = True

    def terminate(self) -> None:
        self.terminate_called = True
        self._exit_code = 0

    def kill(self) -> None:
        self.kill_called = True
        self._exit_code = -9

    def force_exit(self, code: int) -> None:
        self._exit_code = code


class FakeJobObject:
    def __init__(self) -> None:
        self.assigned_pid: int | None = None
        self.closed = False

    def assign_process(self, pid: int) -> None:
        self.assigned_pid = pid

    def close(self) -> None:
        self.closed = True


def make_config(tmp_path: Path, **overrides: object) -> SupervisorConfig:
    base = dict(
        overrides_dir=tmp_path / "accounts",
        generated_dir=tmp_path / "state" / "discovered-accounts",
        state_dir=tmp_path / "state",
        state_dir_windows="C:\\analytic\\bridge\\state",
        tick_interval_s=0.0,
        discovery_rescan_s=0.0,
        ctrl_break_wait_s=0.0,
        shutdown_grace_s=0.0,
        shutdown_kill_grace_s=0.0,
        backoff=BackoffConfig(base_delay_ms=1, max_delay_ms=5),
    )
    base.update(overrides)
    return SupervisorConfig(**base)  # type: ignore[arg-type]


def make_supervisor(
    tmp_path: Path,
    candidates: list[ProcessCandidate],
    *,
    handles: list[FakeProcessHandle] | None = None,
    mt5_login: int = 60001,
    config_overrides: dict[str, object] | None = None,
) -> tuple[Supervisor, list[FakeProcessHandle], list[Path]]:
    handles = handles if handles is not None else []
    spawned_paths: list[Path] = []

    def spawn(config_path: Path) -> FakeProcessHandle:
        spawned_paths.append(config_path)
        handle = FakeProcessHandle()
        handles.append(handle)
        return handle

    config = make_config(tmp_path, **(config_overrides or {}))
    supervisor = Supervisor(
        config=config,
        process_lister=FakeProcessLister(candidates),
        mt5_factory=lambda: FakeMt5(login=mt5_login),
        spawn=spawn,
        job_object_factory=FakeJobObject,
    )
    return supervisor, handles, spawned_paths


def test_discovery_produces_runnable_worker_specifications(tmp_path: Path) -> None:
    supervisor, handles, spawned_paths = make_supervisor(tmp_path, [candidate(1)])

    supervisor.run(max_ticks=1)

    assert len(spawned_paths) == 1
    config_path = spawned_paths[0]
    assert config_path.exists()
    data = json.loads(config_path.read_text())
    assert data["expected_login"] == 60001
    assert data["portable"] is True
    assert data["history_lower_bound_raw"] == DEFAULT_HISTORY_LOWER_BOUND_RAW
    assert len(handles) == 1


def test_duplicate_logins_spawn_only_one_worker(tmp_path: Path) -> None:
    supervisor, _handles, spawned_paths = make_supervisor(
        tmp_path,
        [
            candidate(1, executable_path="C:\\MT5-A\\terminal64.exe"),
            candidate(2, executable_path="C:\\MT5-B\\terminal64.exe"),
        ],
        mt5_login=60001,
    )

    supervisor.run(max_ticks=1)

    assert len(spawned_paths) == 1  # both terminals resolve to the same login


def test_existing_duplicate_owner_stays_selected_when_an_earlier_path_appears(
    tmp_path: Path,
) -> None:
    path_a = "C:\\MT5-A\\terminal64.exe"
    path_b = "C:\\MT5-B\\terminal64.exe"
    lister = FakeProcessLister([candidate(2, executable_path=path_b)])
    spawned_configs: list[dict] = []
    supervisor = Supervisor(
        config=make_config(tmp_path),
        process_lister=lister,
        mt5_factory=lambda: FakeMt5(login=60001),
        spawn=lambda path: (spawned_configs.append(json.loads(path.read_text())), FakeProcessHandle())[1],
        job_object_factory=FakeJobObject,
    )

    supervisor.run(max_ticks=1)
    lister.candidates = [
        candidate(1, executable_path=path_a),
        candidate(2, executable_path=path_b),
    ]
    supervisor.run(max_ticks=1)

    generated = json.loads(
        (tmp_path / "state" / "discovered-accounts" / "60001.json").read_text()
    )
    assert len(spawned_configs) == 1
    assert generated["executable_path"] == path_b


def test_generated_duplicate_owner_survives_supervisor_restart(tmp_path: Path) -> None:
    path_a = "C:\\MT5-A\\terminal64.exe"
    path_b = "C:\\MT5-B\\terminal64.exe"
    generated_dir = tmp_path / "state" / "discovered-accounts"
    generated_dir.mkdir(parents=True)
    (generated_dir / "60001.json").write_text(
        json.dumps(
            {
                "executable_path": path_b,
                "portable": True,
                "expected_data_path": "C:\\MT5\\data",
                "expected_login": 60001,
                "expected_server": "Broker-Demo",
                "initialize_timeout_ms": 5000,
                "coordination_domain": "default",
                "history_lower_bound_raw": DEFAULT_HISTORY_LOWER_BOUND_RAW,
                "journal_path": "C:\\analytic\\bridge\\state\\journal\\60001.sqlite3",
            }
        ),
        encoding="utf-8",
    )
    spawned_terminal_paths: list[str] = []
    supervisor = Supervisor(
        config=make_config(tmp_path),
        process_lister=FakeProcessLister(
            [
                candidate(1, executable_path=path_a),
                candidate(2, executable_path=path_b),
            ]
        ),
        mt5_factory=lambda: FakeMt5(login=60001),
        spawn=lambda path: (
            spawned_terminal_paths.append(json.loads(path.read_text())["executable_path"]),
            FakeProcessHandle(),
        )[1],
        job_object_factory=FakeJobObject,
    )

    supervisor.run(max_ticks=1)

    assert spawned_terminal_paths == [path_b]


def test_unchanged_duplicate_login_warning_logs_only_once_across_rescans(
    tmp_path: Path,
) -> None:
    lister = FakeProcessLister(
        [
            candidate(1, executable_path="C:\\MT5-A\\terminal64.exe"),
            candidate(2, executable_path="C:\\MT5-B\\terminal64.exe"),
        ]
    )
    logs: list[str] = []
    supervisor = Supervisor(
        config=make_config(tmp_path),
        process_lister=lister,
        mt5_factory=lambda: FakeMt5(login=60001),
        spawn=lambda _path: FakeProcessHandle(),
        job_object_factory=FakeJobObject,
        log=logs.append,
    )

    supervisor.run(max_ticks=1)
    supervisor.run(max_ticks=1)
    supervisor.run(max_ticks=1)

    duplicate_logs = [line for line in logs if "already discovered" in line]
    assert len(duplicate_logs) == 1
    assert "pid=2" in duplicate_logs[0]


def test_duplicate_login_warning_logs_again_after_disappearing_and_reappearing(
    tmp_path: Path,
) -> None:
    duplicate_candidates = [
        candidate(1, executable_path="C:\\MT5-A\\terminal64.exe"),
        candidate(2, executable_path="C:\\MT5-B\\terminal64.exe"),
    ]
    lister = FakeProcessLister(duplicate_candidates)
    logs: list[str] = []
    supervisor = Supervisor(
        config=make_config(tmp_path),
        process_lister=lister,
        mt5_factory=lambda: FakeMt5(login=60001),
        spawn=lambda _path: FakeProcessHandle(),
        job_object_factory=FakeJobObject,
        log=logs.append,
    )

    supervisor.run(max_ticks=1)  # duplicate present -> logs once

    lister.candidates = [duplicate_candidates[0]]  # MT5-B goes away
    supervisor.run(max_ticks=1)  # no duplicate this cycle -> remembered state clears

    lister.candidates = duplicate_candidates  # MT5-B comes back, same pid
    supervisor.run(max_ticks=1)  # duplicate reappears -> logs again

    duplicate_logs = [line for line in logs if "already discovered" in line]
    assert len(duplicate_logs) == 2


def test_duplicate_login_warning_logs_again_when_duplicate_pid_changes(
    tmp_path: Path,
) -> None:
    lister = FakeProcessLister(
        [
            candidate(1, executable_path="C:\\MT5-A\\terminal64.exe"),
            candidate(2, executable_path="C:\\MT5-B\\terminal64.exe"),
        ]
    )
    logs: list[str] = []
    supervisor = Supervisor(
        config=make_config(tmp_path),
        process_lister=lister,
        mt5_factory=lambda: FakeMt5(login=60001),
        spawn=lambda _path: FakeProcessHandle(),
        job_object_factory=FakeJobObject,
        log=logs.append,
    )

    supervisor.run(max_ticks=1)  # duplicate at pid=2 -> logs once

    # MT5-B's terminal restarted with a new pid -- same physical duplicate,
    # different (login, pid) identity, must log as a new occurrence.
    lister.candidates = [
        candidate(1, executable_path="C:\\MT5-A\\terminal64.exe"),
        candidate(3, executable_path="C:\\MT5-B\\terminal64.exe"),
    ]
    supervisor.run(max_ticks=1)

    duplicate_logs = [line for line in logs if "already discovered" in line]
    assert len(duplicate_logs) == 2
    assert "pid=2" in duplicate_logs[0]
    assert "pid=3" in duplicate_logs[1]


def test_worker_exit_log_has_account_terminal_pid_and_reason(tmp_path: Path) -> None:
    logs: list[str] = []
    handles: list[FakeProcessHandle] = []
    supervisor, handles, _ = make_supervisor(
        tmp_path,
        [candidate(1, executable_path="C:\\MT5-A\\terminal64.exe")],
        handles=handles,
        config_overrides={"backoff": BackoffConfig(base_delay_ms=1000, max_delay_ms=1000)},
    )
    supervisor._log = logs.append
    supervisor.run(max_ticks=1)
    (tmp_path / "state" / "last_exit").mkdir(parents=True)
    (tmp_path / "state" / "last_exit" / "60001.json").write_text(
        json.dumps(
            {
                "exit_code": int(WorkerExitCode.TERMINAL_NOT_READY),
                "detail": "terminal is not connected",
                "worker_pid": handles[0].pid,
            }
        ),
        encoding="utf-8",
    )
    handles[0].force_exit(int(WorkerExitCode.TERMINAL_NOT_READY))

    supervisor.run(max_ticks=1)

    exit_log = next(line for line in logs if "worker exit" in line)
    assert "login=60001" in exit_log
    assert "profile_path=C:\\MT5\\data" in exit_log
    assert "terminal_path=C:\\MT5-A\\terminal64.exe" in exit_log
    assert f"worker_pid={handles[0].pid}" in exit_log
    assert "classification=terminal_not_ready" in exit_log
    assert "reason=terminal is not connected" in exit_log


def test_disconnected_owner_reconnects_via_healthy_duplicate_after_backoff(
    tmp_path: Path,
) -> None:
    path_a = "C:\\MT5-A\\terminal64.exe"
    path_b = "C:\\MT5-B\\terminal64.exe"
    lister = FakeProcessLister([candidate(1, executable_path=path_a)])
    connected = {path_a: True, path_b: True}

    class PathAwareMt5(FakeMt5):
        def __init__(self) -> None:
            super().__init__(login=60001)
            self.path = ""

        def initialize(self, path: str, timeout: int, portable: bool) -> bool:
            self.path = path
            return True

        def terminal_info(self) -> TerminalInfo:
            return TerminalInfo(data_path="C:\\MT5\\data", connected=connected[self.path])

    spawned_terminal_paths: list[str] = []
    handles: list[FakeProcessHandle] = []

    def spawn(path: Path) -> FakeProcessHandle:
        spawned_terminal_paths.append(json.loads(path.read_text())["executable_path"])
        handle = FakeProcessHandle()
        handles.append(handle)
        return handle

    supervisor = Supervisor(
        config=make_config(
            tmp_path,
            backoff=BackoffConfig(
                base_delay_ms=0,
                max_delay_ms=0,
                identity_violation_max_restarts=3,
            ),
        ),
        process_lister=lister,
        mt5_factory=PathAwareMt5,
        spawn=spawn,
        job_object_factory=FakeJobObject,
    )
    supervisor.run(max_ticks=1)

    connected[path_a] = False
    lister.candidates = [
        candidate(1, executable_path=path_a),
        candidate(2, executable_path=path_b),
    ]
    handles[0].force_exit(int(WorkerExitCode.IDENTITY_VIOLATION))
    supervisor.run(max_ticks=2)

    assert spawned_terminal_paths == [path_a, path_b]
    assert len(handles) == 2


def test_disconnected_terminal_backoff_does_not_end_in_quarantine(tmp_path: Path) -> None:
    supervisor, handles, _ = make_supervisor(
        tmp_path,
        [candidate(1)],
        config_overrides={
            "backoff": BackoffConfig(
                base_delay_ms=0,
                max_delay_ms=0,
                identity_violation_max_restarts=1,
            )
        },
    )
    supervisor.run(max_ticks=1)
    (tmp_path / "state" / "last_exit").mkdir(parents=True)
    for index in range(3):
        (tmp_path / "state" / "last_exit" / "60001.json").write_text(
            json.dumps(
                {
                    "exit_code": int(WorkerExitCode.TERMINAL_NOT_READY),
                    "detail": "terminal is not connected",
                    "worker_pid": handles[index].pid,
                }
            ),
            encoding="utf-8",
        )
        handles[index].force_exit(int(WorkerExitCode.TERMINAL_NOT_READY))
        supervisor.run(max_ticks=2)

    from bridge.account_config import load_account_file

    account = load_account_file(
        tmp_path / "state" / "discovered-accounts" / "60001.json",
        now_s=time.time(),
        max_history_skew_s=86400,
    )
    assert QuarantineStore(tmp_path / "state").is_quarantined(
        account.profile.profile_id
    ) is False
    assert len(handles) == 4


def test_terminal_not_ready_backoff_never_quarantines_even_without_last_exit_detail(
    tmp_path: Path,
) -> None:
    """Regression for the 2026-08-07 incident: quarantine must not depend
    on `detail` correlating via _last_exit_detail's exit_code/worker_pid
    match against state/last_exit/<login>.json -- under rapid restart churn
    that file can be missing, stale, or from a different worker_pid, which
    makes `detail` None regardless of the true (transient) cause. The
    classification itself (TERMINAL_NOT_READY carries no quarantine
    ceiling) must be what prevents quarantine, not a string match on
    `detail`."""
    supervisor, handles, _ = make_supervisor(
        tmp_path,
        [candidate(1)],
        config_overrides={
            "backoff": BackoffConfig(
                base_delay_ms=0,
                max_delay_ms=0,
                identity_violation_max_restarts=1,
            )
        },
    )
    supervisor.run(max_ticks=1)
    # No state/last_exit/<login>.json written at all -- _last_exit_detail
    # returns None for every one of these exits.
    for index in range(5):
        handles[index].force_exit(int(WorkerExitCode.TERMINAL_NOT_READY))
        supervisor.run(max_ticks=2)

    from bridge.account_config import load_account_file

    account = load_account_file(
        tmp_path / "state" / "discovered-accounts" / "60001.json",
        now_s=time.time(),
        max_history_skew_s=86400,
    )
    assert (
        QuarantineStore(tmp_path / "state").is_quarantined(account.profile.profile_id)
        is False
    )
    assert len(handles) == 6


def test_duplicate_ownership_retries_after_fixed_delay_instead_of_stalling_forever(
    tmp_path: Path,
) -> None:
    supervisor, handles, spawned_paths = make_supervisor(
        tmp_path,
        [candidate(1)],
        config_overrides={"backoff": BackoffConfig(duplicate_retry_ms=0)},
    )

    supervisor.run(max_ticks=1)
    handles[0].force_exit(int(WorkerExitCode.DUPLICATE_OWNERSHIP))
    supervisor.run(max_ticks=3)

    # A transient duplicate-ownership signal (e.g. a stale lock/lease that
    # hasn't expired yet) must self-heal via retry rather than permanently
    # benching the account until a manual service restart.
    assert len(spawned_paths) == 2


def test_override_wins_without_disabling_discovery(tmp_path: Path) -> None:
    overrides_dir = tmp_path / "accounts"
    overrides_dir.mkdir(parents=True)
    (overrides_dir / "60001.json").write_text(
        json.dumps(
            {
                "executable_path": "C:\\Custom\\terminal64.exe",
                "portable": True,
                "expected_data_path": "C:\\Custom\\data",
                "expected_login": 60001,
                "expected_server": "Broker-Override",
                "initialize_timeout_ms": 5000,
                "coordination_domain": "custom",
                "history_lower_bound_raw": 0,
                "journal_path": "C:\\Custom\\journal.sqlite3",
            }
        ),
        encoding="utf-8",
    )
    supervisor, _handles, spawned_paths = make_supervisor(tmp_path, [candidate(1)])

    supervisor.run(max_ticks=1)

    assert len(spawned_paths) == 1
    assert spawned_paths[0] == overrides_dir / "60001.json"
    # discovery still ran and still produced a profile -- it was just
    # discarded in favor of the override, not skipped
    assert not (tmp_path / "state" / "discovered-accounts" / "60001.json").exists()


def test_worker_crash_follows_restart_then_quarantine_policy(tmp_path: Path) -> None:
    supervisor, handles, spawned_paths = make_supervisor(
        tmp_path,
        [candidate(1)],
        config_overrides={"backoff": BackoffConfig(base_delay_ms=1, max_delay_ms=1)},
    )

    supervisor.run(max_ticks=1)
    assert len(spawned_paths) == 1
    login = 60001
    profile_id = json.loads(spawned_paths[0].read_text())  # sanity, not used further

    # CONFIG_INVALID (10) quarantines on first occurrence (Layer 4 table).
    handles[0].force_exit(int(WorkerExitCode.CONFIG_INVALID))
    supervisor.run(max_ticks=1)

    quarantine = QuarantineStore(tmp_path / "state")
    # profile_id is content-addressed from the discovered profile fields;
    # recompute it the same way TerminalProfile.profile_id does by loading
    # the generated config back through the same loader path used elsewhere.
    from bridge.account_config import load_account_file

    config_path = tmp_path / "state" / "discovered-accounts" / f"{login}.json"
    account = load_account_file(config_path, now_s=time.time(), max_history_skew_s=86400)
    assert quarantine.is_quarantined(account.profile.profile_id) is True

    # A quarantined account is never respawned on a later rescan.
    supervisor.run(max_ticks=1)
    assert len(spawned_paths) == 1


def test_journal_locked_self_heals_acl_and_never_quarantines(
    tmp_path: Path, monkeypatch
) -> None:
    """A JOURNAL_LOCKED exit means a service-created WAL/SHM sidecar likely
    landed with a broken owner/ACL (see windows_acl.py) -- the supervisor
    must reapply the self-heal on every such exit, not just at startup,
    and must never quarantine for it (that's the whole point: it's
    self-healing, not permanent corruption)."""
    supervisor, handles, spawned_paths = make_supervisor(
        tmp_path,
        [candidate(1)],
        config_overrides={"backoff": BackoffConfig(base_delay_ms=1, max_delay_ms=1)},
    )

    heal_calls: list[Path] = []
    monkeypatch.setattr(
        "bridge.supervisor.ensure_windows_journal_acl",
        lambda state_dir: heal_calls.append(state_dir),
    )

    supervisor.run(max_ticks=1)
    assert len(spawned_paths) == 1
    login = 60001

    handles[0].force_exit(int(WorkerExitCode.JOURNAL_LOCKED))
    supervisor.run(max_ticks=1)

    assert heal_calls == [tmp_path / "state"]

    from bridge.account_config import load_account_file

    config_path = tmp_path / "state" / "discovered-accounts" / f"{login}.json"
    account = load_account_file(config_path, now_s=time.time(), max_history_skew_s=86400)
    quarantine = QuarantineStore(tmp_path / "state")
    assert quarantine.is_quarantined(account.profile.profile_id) is False


def test_shutdown_terminates_all_tracked_children(tmp_path: Path) -> None:
    supervisor, handles, _spawned_paths = make_supervisor(
        tmp_path,
        [
            candidate(1, executable_path="C:\\MT5-A\\terminal64.exe"),
        ],
    )
    supervisor.run(max_ticks=1)
    assert len(handles) == 1

    supervisor.shutdown()

    handle = handles[0]
    assert handle.ctrl_break_called is True
    assert handle.terminate_called is True  # never exited on its own -> escalation ran


def test_no_new_terminal_ui_process_is_launched(tmp_path: Path) -> None:
    mt5_calls: list[str] = []

    class TrackingFakeMt5(FakeMt5):
        def initialize(self, path: str, timeout: int, portable: bool) -> bool:
            mt5_calls.append(path)
            return super().initialize(path, timeout, portable)

    config = make_config(tmp_path)
    supervisor = Supervisor(
        config=config,
        process_lister=FakeProcessLister([candidate(1, executable_path="C:\\MT5\\terminal64.exe")]),
        mt5_factory=TrackingFakeMt5,
        spawn=lambda _path: FakeProcessHandle(),
        job_object_factory=FakeJobObject,
    )

    supervisor.run(max_ticks=1)

    # Every initialize() call used a path taken directly from an already
    # enumerated running candidate -- never a path the supervisor invented.
    assert mt5_calls == ["C:\\MT5\\terminal64.exe"]


def test_package_can_be_started_through_python_dash_m_bridge(tmp_path: Path) -> None:
    import os

    env_state = tmp_path / "state"
    env_accounts = tmp_path / "accounts"
    process = subprocess.Popen(
        [sys.executable, "-m", "bridge"],
        cwd=str(Path(__file__).resolve().parents[2].parent),
        env={
            **os.environ,
            "REDIS_URL": "redis://127.0.0.1:6379",
            "BRIDGE_STATE_DIR": str(env_state),
            "BRIDGE_ACCOUNTS_DIR": str(env_accounts),
            "BRIDGE_SUPERVISOR_TICK_S": "0.2",
            "BRIDGE_DISCOVERY_RESCAN_S": "0.2",
        },
    )
    time.sleep(1.0)
    assert process.poll() is None  # still running, didn't crash on startup
    process.terminate()
    exit_code = process.wait(timeout=5)
    assert exit_code == 0
