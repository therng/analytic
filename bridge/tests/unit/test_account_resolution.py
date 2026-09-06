from __future__ import annotations

import json
from collections import namedtuple
from pathlib import Path

from bridge.account_resolution import resolve_accounts
from bridge.config import DEFAULT_HISTORY_LOWER_BOUND_RAW
from bridge.process_probe import ProcessCandidate

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
        self._candidates = candidates

    def build_candidates(self) -> list[ProcessCandidate]:
        return self._candidates


class FakeMt5:
    def __init__(self, login: int = 40001, server: str = "Broker-Demo") -> None:
        self._login = login
        self._server = server

    def initialize(self, path: str, timeout: int, portable: bool) -> bool:
        return True

    def shutdown(self) -> None:
        pass

    def terminal_info(self) -> TerminalInfo:
        return TerminalInfo(data_path="C:\\MT5\\data", connected=True)

    def account_info(self) -> AccountInfo:
        return AccountInfo(login=self._login, server=self._server)


def test_discovered_account_is_generated_written_and_loaded(tmp_path: Path) -> None:
    overrides_dir = tmp_path / "accounts"
    generated_dir = tmp_path / "state" / "discovered-accounts"
    lister = FakeProcessLister([candidate(1)])

    result = resolve_accounts(
        process_lister=lister,
        mt5_factory=lambda: FakeMt5(login=40001),
        overrides_dir=overrides_dir,
        generated_dir=generated_dir,
        now_s=1_800_000_000.0,
        max_history_skew_s=86400,
    )

    assert result.errors == ()
    assert len(result.configs) == 1
    assert result.configs[0].profile.expected_login == 40001
    generated_file = generated_dir / "40001.json"
    assert generated_file.exists()
    data = json.loads(generated_file.read_text())
    assert data["expected_login"] == 40001
    assert data["portable"] is True
    assert data["history_lower_bound_raw"] == DEFAULT_HISTORY_LOWER_BOUND_RAW


def test_override_file_wins_over_discovered_profile(tmp_path: Path) -> None:
    overrides_dir = tmp_path / "accounts"
    overrides_dir.mkdir(parents=True)
    generated_dir = tmp_path / "state" / "discovered-accounts"
    override_path = overrides_dir / "40001.json"
    override_path.write_text(
        json.dumps(
            {
                "executable_path": "C:\\Custom\\terminal64.exe",
                "portable": True,
                "expected_data_path": "C:\\Custom\\data",
                "expected_login": 40001,
                "expected_server": "Broker-Override",
                "initialize_timeout_ms": 5000,
                "coordination_domain": "custom",
                "history_lower_bound_raw": 0,
                "journal_path": "C:\\Custom\\journal.sqlite3",
            }
        ),
        encoding="utf-8",
    )
    lister = FakeProcessLister([candidate(1)])

    result = resolve_accounts(
        process_lister=lister,
        mt5_factory=lambda: FakeMt5(login=40001),
        overrides_dir=overrides_dir,
        generated_dir=generated_dir,
        now_s=1_800_000_000.0,
        max_history_skew_s=86400,
    )

    assert result.errors == ()
    assert len(result.configs) == 1
    assert result.configs[0].profile.expected_server == "Broker-Override"
    assert not (generated_dir / "40001.json").exists()  # discovery never wrote one
    assert any("override file present" in warning for warning in result.warnings)


def test_override_for_account_not_currently_discovered_still_loads(tmp_path: Path) -> None:
    overrides_dir = tmp_path / "accounts"
    overrides_dir.mkdir(parents=True)
    generated_dir = tmp_path / "state" / "discovered-accounts"
    override_path = overrides_dir / "50001.json"
    override_path.write_text(
        json.dumps(
            {
                "executable_path": "C:\\Custom\\terminal64.exe",
                "portable": True,
                "expected_data_path": "C:\\Custom\\data",
                "expected_login": 50001,
                "expected_server": "Broker-Standby",
                "initialize_timeout_ms": 5000,
                "coordination_domain": "custom",
                "history_lower_bound_raw": 0,
                "journal_path": "C:\\Custom\\journal.sqlite3",
            }
        ),
        encoding="utf-8",
    )
    lister = FakeProcessLister([])  # nothing running right now

    result = resolve_accounts(
        process_lister=lister,
        mt5_factory=lambda: FakeMt5(),
        overrides_dir=overrides_dir,
        generated_dir=generated_dir,
        now_s=1_800_000_000.0,
        max_history_skew_s=86400,
    )

    assert result.errors == ()
    assert [config.profile.expected_login for config in result.configs] == [50001]


class QueueProcessLister:
    def __init__(self, snapshots: list[list[ProcessCandidate]]) -> None:
        self._snapshots = list(snapshots)
        self.calls = 0

    def build_candidates(self) -> list[ProcessCandidate]:
        snapshot = self._snapshots[min(self.calls, len(self._snapshots) - 1)]
        self.calls += 1
        return snapshot


class FakeKiller:
    def __init__(self) -> None:
        self.killed: list[int] = []

    def kill(self, pid: int, creation_time: float) -> str:
        self.killed.append(pid)
        return "terminated"


def test_process_killer_passthrough_reaches_discovery(tmp_path: Path) -> None:
    """Pins the Supervisor -> resolve_accounts -> discover_accounts kill
    wiring: severing the pass-through must fail here, not in production
    during the next spawn."""
    probed = candidate(1)
    spawned = candidate(2)
    lister = QueueProcessLister([[probed], [probed, spawned], [probed]])
    killer = FakeKiller()

    result = resolve_accounts(
        process_lister=lister,
        mt5_factory=lambda: FakeMt5(login=40001),
        overrides_dir=tmp_path / "accounts",
        generated_dir=tmp_path / "state" / "discovered-accounts",
        now_s=1_800_000_000.0,
        max_history_skew_s=86400,
        process_killer=killer,
    )

    assert killer.killed == [2]
    assert any("unexpected_terminal_launch" in warning for warning in result.warnings)
    assert result.configs == ()  # the guarded candidate is skipped, not resolved
