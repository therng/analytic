from __future__ import annotations

from collections import namedtuple

from bridge.discovery import discover_accounts, parse_duplicate_login_warning
from bridge.config import DEFAULT_HISTORY_LOWER_BOUND_RAW
from bridge.process_probe import ProcessCandidate

TerminalInfo = namedtuple("TerminalInfo", ["data_path", "connected"])
AccountInfo = namedtuple("AccountInfo", ["login", "server"])


def candidate(
    pid: int,
    *,
    creation_time: float = 1000.0,
    executable_path: str = "C:\\MT5\\terminal64.exe",
    portable: bool = True,
    evidence_complete: bool = True,
) -> ProcessCandidate:
    return ProcessCandidate(
        pid=pid,
        creation_time=creation_time,
        executable_path=executable_path,
        command_line=(executable_path, "/portable") if portable else (executable_path,),
        process_user="svc",
        session_id=0,
        data_path="C:\\MT5\\data" if evidence_complete else "",
        evidence_complete=evidence_complete,
    )


class FakeProcessLister:
    def __init__(self, candidates: list[ProcessCandidate]) -> None:
        self._candidates = candidates

    def build_candidates(self) -> list[ProcessCandidate]:
        return self._candidates


class QueueProcessLister:
    """Returns successive snapshots so a test can change the process set
    between discovery's initial enumeration and the spawn guard's
    re-enumeration around initialize(); the last snapshot repeats."""

    def __init__(self, snapshots: list[list[ProcessCandidate]]) -> None:
        self._snapshots = list(snapshots)
        self.calls = 0

    def build_candidates(self) -> list[ProcessCandidate]:
        snapshot = self._snapshots[min(self.calls, len(self._snapshots) - 1)]
        self.calls += 1
        return snapshot


class FakeKiller:
    def __init__(self, outcome: str = "terminated") -> None:
        self.outcome = outcome
        self.killed: list[tuple[int, float]] = []

    def kill(self, pid: int, creation_time: float) -> str:
        self.killed.append((pid, creation_time))
        return self.outcome


class FakeMt5:
    def __init__(
        self,
        *,
        initialize_ok: bool = True,
        connected: bool = True,
        login: int = 30001,
        server: str = "Broker-Demo",
        data_path: str = "C:\\MT5\\data",
        raise_on_initialize: bool = False,
    ) -> None:
        self._initialize_ok = initialize_ok
        self._connected = connected
        self._login = login
        self._server = server
        self._data_path = data_path
        self._raise_on_initialize = raise_on_initialize
        self.initialize_calls: list[tuple[str, int, bool]] = []
        self.shutdown_called = False

    def initialize(self, path: str, timeout: int, portable: bool) -> bool:
        self.initialize_calls.append((path, timeout, portable))
        if self._raise_on_initialize:
            raise RuntimeError("IPC failure")
        return self._initialize_ok

    def shutdown(self) -> None:
        self.shutdown_called = True

    def terminal_info(self) -> TerminalInfo:
        return TerminalInfo(data_path=self._data_path, connected=self._connected)

    def account_info(self) -> AccountInfo:
        return AccountInfo(login=self._login, server=self._server)


def test_discovers_single_portable_terminal() -> None:
    fake = FakeMt5(login=30001, server="Broker-Demo", data_path="C:\\MT5\\data")
    lister = FakeProcessLister([candidate(1)])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=lambda: fake
    )

    assert warnings == ()
    assert len(discovered) == 1
    account = discovered[0]
    assert account.source_pid == 1
    assert account.profile.expected_login == 30001
    assert account.profile.expected_server == "Broker-Demo"
    assert account.profile.expected_data_path == "C:\\MT5\\data"
    assert account.profile.executable_path == "C:\\MT5\\terminal64.exe"
    assert account.profile.portable is True
    assert account.profile.history_lower_bound_raw == DEFAULT_HISTORY_LOWER_BOUND_RAW
    assert fake.initialize_calls == [("C:\\MT5\\terminal64.exe", 10_000, True)]
    assert fake.shutdown_called is True  # never left attached after discovery


def test_never_calls_initialize_for_non_portable_terminal() -> None:
    fake = FakeMt5()
    lister = FakeProcessLister([candidate(1, portable=False)])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=lambda: fake
    )

    assert discovered == ()
    assert fake.initialize_calls == []  # no window ever opened for a skipped candidate
    assert "portable" in warnings[0]


def test_skips_candidate_with_incomplete_evidence_without_connecting() -> None:
    fake = FakeMt5()
    lister = FakeProcessLister([candidate(1, evidence_complete=False)])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=lambda: fake
    )

    assert discovered == ()
    assert fake.initialize_calls == []
    assert "incomplete" in warnings[0]


def test_initialize_failure_skips_candidate_and_still_shuts_down() -> None:
    fake = FakeMt5(initialize_ok=False)
    lister = FakeProcessLister([candidate(1)])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=lambda: fake
    )

    assert discovered == ()
    assert "initialize failed" in warnings[0]
    assert fake.shutdown_called is True


def test_initialize_exception_is_isolated_and_still_shuts_down() -> None:
    fake = FakeMt5(raise_on_initialize=True)
    lister = FakeProcessLister([candidate(1)])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=lambda: fake
    )

    assert discovered == ()
    assert "RuntimeError" in warnings[0]
    assert fake.shutdown_called is True


def test_disconnected_terminal_is_skipped() -> None:
    fake = FakeMt5(connected=False)
    lister = FakeProcessLister([candidate(1)])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=lambda: fake
    )

    assert discovered == ()
    assert "not connected" in warnings[0]


def test_two_processes_same_login_deduplicate_to_one_account() -> None:
    calls = {"count": 0}

    def factory() -> FakeMt5:
        calls["count"] += 1
        return FakeMt5(login=30001, server="Broker-Demo")

    lister = FakeProcessLister(
        [
            candidate(1, executable_path="C:\\MT5-A\\terminal64.exe"),
            candidate(2, executable_path="C:\\MT5-B\\terminal64.exe"),
        ]
    )

    discovered, warnings = discover_accounts(process_lister=lister, mt5_factory=factory)

    assert len(discovered) == 1  # one bridge process per unique account, not per terminal
    assert calls["count"] == 2  # both were connected-to before the duplicate was detected
    assert any("already discovered" in warning for warning in warnings)


def test_duplicate_owner_is_deterministic_and_preserves_preferred_path() -> None:
    paths = ["C:\\MT5-B\\terminal64.exe", "C:\\MT5-A\\terminal64.exe"]
    lister = FakeProcessLister(
        [candidate(2, executable_path=paths[0]), candidate(1, executable_path=paths[1])]
    )

    deterministic, _ = discover_accounts(
        process_lister=lister,
        mt5_factory=lambda: FakeMt5(login=30001, server="Broker-Demo"),
    )
    preferred, _ = discover_accounts(
        process_lister=lister,
        mt5_factory=lambda: FakeMt5(login=30001, server="Broker-Demo"),
        preferred_executable_paths={30001: paths[0]},
    )

    assert deterministic[0].profile.executable_path == paths[1]
    assert preferred[0].profile.executable_path == paths[0]


def test_parse_duplicate_login_warning_extracts_login_and_pid() -> None:
    warning = (
        "pid=7116: login 7948784 already discovered from another process, "
        "ignoring this duplicate"
    )
    assert parse_duplicate_login_warning(warning) == (7948784, 7116)


def test_parse_duplicate_login_warning_returns_none_for_other_warnings() -> None:
    assert parse_duplicate_login_warning("pid=1: not running in portable mode, skipped") is None
    assert parse_duplicate_login_warning("pid=1: incomplete process evidence, skipped") is None


def test_duplicate_executable_path_candidates_connect_only_once() -> None:
    calls = {"count": 0}

    def factory() -> FakeMt5:
        calls["count"] += 1
        return FakeMt5()

    lister = FakeProcessLister([candidate(1), candidate(1)])  # same path, seen twice

    discover_accounts(process_lister=lister, mt5_factory=factory)

    assert calls["count"] == 1


def test_spawned_duplicate_during_initialize_is_killed_and_skipped() -> None:
    fake = FakeMt5()
    killer = FakeKiller()
    probed = candidate(1)
    spawned = candidate(2, creation_time=2000.0)
    # enumeration -> guard watch (duplicate visible) -> post-kill watch (gone)
    lister = QueueProcessLister([[probed], [probed, spawned], [probed]])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=lambda: fake, process_killer=killer
    )

    assert discovered == ()
    assert "unexpected_terminal_launch" in warnings[0]
    assert "STILL RUNNING" not in warnings[0]
    assert killer.killed == [(2, 2000.0)]
    assert fake.initialize_calls == [("C:\\MT5\\terminal64.exe", 10_000, True)]
    assert fake.shutdown_called is True
    assert lister.calls == 3  # enumeration + guard watch + post-kill verification


def test_every_spawned_duplicate_is_killed() -> None:
    killer = FakeKiller()
    probed = candidate(1)
    first = candidate(2, creation_time=2000.0)
    second = candidate(3, creation_time=3000.0)
    lister = QueueProcessLister(
        [[probed], [probed, first, second], [probed]]
    )

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=lambda: FakeMt5(), process_killer=killer
    )

    assert discovered == ()
    assert killer.killed == [(2, 2000.0), (3, 3000.0)]
    assert "unexpected_terminal_launch" in warnings[0]
    assert "2 new" in warnings[0]


def test_duplicate_that_survives_its_kill_is_flagged_not_absorbed() -> None:
    killer = FakeKiller(outcome="survived kill escalation")
    probed = candidate(1)
    spawned = candidate(2, creation_time=2000.0)
    lister = QueueProcessLister(
        [[probed], [probed, spawned], [probed, spawned]]
    )

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=lambda: FakeMt5(), process_killer=killer
    )

    assert discovered == ()
    assert "unexpected_terminal_launch" in warnings[0]
    assert "survived kill escalation" in warnings[0]
    assert "STILL RUNNING after kill: pid=2" in warnings[0]
    assert "manual intervention" in warnings[0]
    assert killer.killed == [(2, 2000.0)]


def test_replaced_terminal_during_initialize_is_skipped_not_killed() -> None:
    killer = FakeKiller()
    probed = candidate(1)
    replacement = candidate(2, creation_time=2000.0)
    lister = QueueProcessLister([[probed], [replacement]])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=lambda: FakeMt5(), process_killer=killer
    )

    assert discovered == ()
    assert "terminal_process_replaced" in warnings[0]
    assert killer.killed == []
    assert lister.calls == 2  # replacement branch never runs a post-kill watch


def test_exited_terminal_during_initialize_is_skipped_not_killed() -> None:
    killer = FakeKiller()
    probed = candidate(1)
    lister = QueueProcessLister([[probed], []])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=lambda: FakeMt5(), process_killer=killer
    )

    assert discovered == ()
    assert "terminal_process_exited_during_initialize" in warnings[0]
    assert killer.killed == []


def test_spawn_detection_takes_precedence_over_initialize_failure() -> None:
    killer = FakeKiller()
    probed = candidate(1)
    spawned = candidate(2, creation_time=2000.0)
    lister = QueueProcessLister([[probed], [probed, spawned], [probed]])

    discovered, warnings = discover_accounts(
        process_lister=lister,
        mt5_factory=lambda: FakeMt5(initialize_ok=False),
        process_killer=killer,
    )

    assert discovered == ()
    assert "unexpected_terminal_launch" in warnings[0]
    assert "initialize failed" not in warnings[0]
    assert killer.killed == [(2, 2000.0)]


def test_spawn_detection_applies_when_initialize_raises() -> None:
    killer = FakeKiller()
    probed = candidate(1)
    spawned = candidate(2, creation_time=2000.0)
    lister = QueueProcessLister([[probed], [probed, spawned], [probed]])

    discovered, warnings = discover_accounts(
        process_lister=lister,
        mt5_factory=lambda: FakeMt5(raise_on_initialize=True),
        process_killer=killer,
    )

    assert discovered == ()
    assert "unexpected_terminal_launch" in warnings[0]
    assert killer.killed == [(2, 2000.0)]


def test_spawn_at_a_different_path_does_not_trigger_the_guard() -> None:
    killer = FakeKiller()
    probed = candidate(1, executable_path="C:\\MT5-A\\terminal64.exe")
    unrelated = candidate(9, creation_time=9000.0, executable_path="C:\\MT5-B\\terminal64.exe")
    lister = QueueProcessLister([[probed], [probed, unrelated]])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=lambda: FakeMt5(), process_killer=killer
    )

    assert warnings == ()
    assert killer.killed == []
    assert len(discovered) == 1  # the guard is scoped to the probed executable path


def test_spawn_during_another_candidates_window_is_not_misattributed() -> None:
    """A process that appeared during candidate A's initialize() window at
    candidate B's path predates B's own initialize() -- the rolling
    baseline must attribute it to nobody, not kill it as B's spawn."""
    killer = FakeKiller()
    a = candidate(1, executable_path="C:\\MT5-A\\terminal64.exe")
    b = candidate(2, executable_path="C:\\MT5-B\\terminal64.exe")
    early = candidate(3, creation_time=2000.0, executable_path="C:\\MT5-B\\terminal64.exe")
    logins = iter([30001, 30002])

    def factory() -> FakeMt5:
        return FakeMt5(login=next(logins))

    lister = QueueProcessLister([[a, b], [a, b, early], [a, b, early]])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=factory, process_killer=killer
    )

    assert warnings == ()
    assert killer.killed == []
    assert [account.profile.expected_login for account in discovered] == [30001, 30002]


def test_spawn_during_own_window_is_caught_with_earlier_candidate_present() -> None:
    """Multi-candidate sequencing: the duplicate appears at B's path only
    across B's own initialize() window; A's earlier guard watch (which
    rolled into B's baseline) did not contain it."""
    killer = FakeKiller()
    a = candidate(1, executable_path="C:\\MT5-A\\terminal64.exe")
    b = candidate(2, executable_path="C:\\MT5-B\\terminal64.exe")
    spawned = candidate(3, creation_time=2000.0, executable_path="C:\\MT5-B\\terminal64.exe")
    logins = iter([30001, 30002])

    def factory() -> FakeMt5:
        return FakeMt5(login=next(logins))

    # enumeration, A's guard watch, B's guard watch (spawn visible), post-kill
    lister = QueueProcessLister([[a, b], [a, b], [a, b, spawned], [a, b]])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=factory, process_killer=killer
    )

    assert killer.killed == [(3, 2000.0)]
    assert "unexpected_terminal_launch" in warnings[0]
    assert "STILL RUNNING" not in warnings[0]
    assert lister.calls == 4
    # A is discovered normally; B is skipped by its guard, not by A's outcome
    assert [account.profile.expected_login for account in discovered] == [30001]


def test_guard_kill_on_first_candidate_does_not_abort_the_rest() -> None:
    killer = FakeKiller()
    a = candidate(1, executable_path="C:\\MT5-A\\terminal64.exe")
    b = candidate(2, executable_path="C:\\MT5-B\\terminal64.exe")
    spawned = candidate(3, creation_time=2000.0, executable_path="C:\\MT5-A\\terminal64.exe")
    logins = iter([30001, 30002])

    def factory() -> FakeMt5:
        return FakeMt5(login=next(logins))

    # enumeration, A's guard watch (spawn at A's path), post-kill watch, B's guard
    lister = QueueProcessLister([[a, b], [a, spawned, b], [a, b], [a, b]])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=factory, process_killer=killer
    )

    assert killer.killed == [(3, 2000.0)]
    assert any("unexpected_terminal_launch" in warning for warning in warnings)
    # B still discovered -- one candidate's guard action never aborts the rest
    assert [account.profile.expected_login for account in discovered] == [30002]


def test_default_process_killer_runs_when_none_injected() -> None:
    """The lazy default-killer fallback must actually construct and execute
    (its import path is only exercised the moment a spawn is detected)."""
    probed = candidate(1)
    spawned = candidate(999_999, creation_time=2000.0)  # no such pid anywhere
    lister = QueueProcessLister([[probed], [probed, spawned], [probed]])

    discovered, warnings = discover_accounts(
        process_lister=lister, mt5_factory=lambda: FakeMt5()
    )

    assert discovered == ()
    assert "unexpected_terminal_launch" in warnings[0]
    assert "already exited before kill" in warnings[0]
