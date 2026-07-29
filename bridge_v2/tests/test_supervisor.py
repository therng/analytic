"""Account-level election/failover — the real bug found on VPS.

MT7 and MT8 both logged into account 7948784. The old path-keyed supervisor
spawned a bridge for EACH terminal and let the Redis login lock sort it out
after the fact. Under a stale/transitional lock, both children can exit 20
in the same window, leaving the account with NO running bridge at all. These
tests drive the real `AccountSupervisor` (imported, not re-implemented) so
there is no drift between what's tested and what `run()` actually executes.
"""

import argparse

import pytest

from bridge_v2.mt5_client import CallResult, CallStatus
from bridge_v2.run_all_v2 import (
    EXIT_DUPLICATE,
    AccountSupervisor,
    _parse_broker_offsets,
    _spawn,
    backoff_delay,
    group_candidates_by_login,
    is_duplicate_exit,
    lock_owner_healthy,
    normalize_terminal_path,
    probe_login,
)

MT7 = normalize_terminal_path(r"C:\MT7\terminal64.exe")
MT8 = normalize_terminal_path(r"C:\MT8\terminal64.exe")


# ── pure helpers ─────────────────────────────────────────────────────────────
def test_duplicate_exit_code_is_recognized():
    assert is_duplicate_exit(EXIT_DUPLICATE) is True
    assert is_duplicate_exit(0) is False
    assert is_duplicate_exit(None) is False


def test_backoff_grows_and_is_bounded():
    assert backoff_delay(1) == 2.0
    assert backoff_delay(2) == 4.0
    assert backoff_delay(10) == 60.0


def test_normalize_terminal_path_is_case_and_slash_insensitive():
    assert normalize_terminal_path(r"C:\MT5\Terminal64.exe") == normalize_terminal_path(r"c:\mt5\terminal64.exe")


def test_lock_owner_healthy_requires_both_lock_and_fresh_heartbeat():
    assert lock_owner_healthy(None, {"lastSeen": "100"}, now=100) is False           # no lock
    assert lock_owner_healthy("pid-1", None, now=100) is False                       # no heartbeat
    assert lock_owner_healthy("pid-1", {"lastSeen": "95"}, now=100) is True          # fresh (5s old)
    assert lock_owner_healthy("pid-1", {"lastSeen": "50"}, now=100) is False         # stale (50s old, ttl*2=20)
    assert lock_owner_healthy("pid-1", {"lastSeen": "bad"}, now=100) is False        # malformed


# ── probe / grouping ─────────────────────────────────────────────────────────
class FakeProbeClient:
    """Fakes Mt5Client's initialize/account_info/shutdown for probe_login."""

    def __init__(self, terminal_path, login=None, fail=False, raises=None):
        self.terminal_path = terminal_path
        self._login = login
        self._fail = fail
        self._raises = raises
        self.shutdown_called = False

    def initialize(self):
        if self._raises:
            raise self._raises

    def account_info(self):
        if self._fail:
            return CallResult(CallStatus.FAILED, last_error=(-1, "no ipc"))
        return CallResult(CallStatus.OK, value={"login": self._login})

    def shutdown(self):
        self.shutdown_called = True


def test_probe_login_returns_login_on_success():
    factory = lambda path: FakeProbeClient(path, login=7948784)
    assert probe_login(r"C:\MT7\terminal64.exe", client_factory=factory) == 7948784


def test_probe_login_returns_none_on_failed_account_info():
    factory = lambda path: FakeProbeClient(path, fail=True)
    assert probe_login(r"C:\MT7\terminal64.exe", client_factory=factory) is None


def test_probe_login_returns_none_on_exception_and_still_shuts_down():
    holder = {}

    def factory(path):
        c = FakeProbeClient(path, raises=OSError("ipc down"))
        holder["client"] = c
        return c

    assert probe_login(r"C:\MT7\terminal64.exe", client_factory=factory) is None
    assert holder["client"].shutdown_called is True  # no leaked MT5 handle


def test_group_candidates_by_login_groups_two_terminals_on_one_account():
    def factory(path):
        return FakeProbeClient(path, login=7948784)

    groups = group_candidates_by_login([r"C:\MT7\terminal64.exe", r"C:\MT8\terminal64.exe"], client_factory=factory)
    assert list(groups.keys()) == [7948784]
    assert set(groups[7948784].keys()) == {MT7, MT8}


def test_group_candidates_excludes_unprobeable_terminals():
    def factory(path):
        return FakeProbeClient(path, login=7948784) if "MT7" in path else FakeProbeClient(path, fail=True)

    groups = group_candidates_by_login([r"C:\MT7\terminal64.exe", r"C:\MT8\terminal64.exe"], client_factory=factory)
    assert set(groups[7948784].keys()) == {MT7}


# ── AccountSupervisor: the core election/failover state machine ─────────────
def test_single_candidate_elects_immediately():
    sup = AccountSupervisor(7948784, [MT7])
    assert sup.ready_to_spawn(now=0) == MT7


def test_two_candidates_same_account_elect_exactly_one():
    sup = AccountSupervisor(7948784, [MT7, MT8])
    elected = sup.ready_to_spawn(now=0)
    assert elected in (MT7, MT8)
    # Sticky: re-electing without an exit keeps the same candidate (no thrash).
    assert sup.elect() == elected


def test_election_is_deterministic_lexicographic_without_primary():
    sup = AccountSupervisor(7948784, [MT8, MT7])  # unsorted input
    assert sup.ready_to_spawn(now=0) == min(MT7, MT8)


def test_primary_preference_wins_when_configured():
    sup = AccountSupervisor(7948784, [MT7, MT8], primary=MT8)
    assert sup.ready_to_spawn(now=0) == MT8


def test_healthy_duplicate_exit_fails_over_to_sibling_not_a_crash_backoff():
    sup = AccountSupervisor(7948784, [MT7, MT8])
    sup.active_path = MT7
    action = sup.record_exit(MT7, EXIT_DUPLICATE, lock_healthy=True, now=0)
    assert action == "failover"
    assert sup.ready_to_spawn(now=0) == MT8  # immediately, no backoff wait


def test_stale_lock_duplicate_retries_same_candidate_after_lock_ttl_not_permanently():
    from bridge_v2 import config

    sup = AccountSupervisor(7948784, [MT7])
    sup.active_path = MT7
    action = sup.record_exit(MT7, EXIT_DUPLICATE, lock_healthy=False, now=0)
    assert action == "stale-lock-retry"
    assert sup.ready_to_spawn(now=0) is None                       # not yet
    assert sup.ready_to_spawn(now=config.LOCK_TTL + 1) == MT7       # after TTL, tries again
    assert MT7 not in sup.tried                                    # never permanently ruled out


def test_both_candidates_healthy_duplicate_never_leaves_account_permanently_unserved():
    """The exact VPS failure: MT7 exit 20, MT8 exit 20, both against a
    healthy rival — must not get stuck forever; after one lock TTL the whole
    group gets another chance."""
    from bridge_v2 import config

    sup = AccountSupervisor(7948784, [MT7, MT8])
    sup.active_path = MT7
    assert sup.record_exit(MT7, EXIT_DUPLICATE, lock_healthy=True, now=0) == "failover"
    sup.active_path = MT8
    assert sup.record_exit(MT8, EXIT_DUPLICATE, lock_healthy=True, now=1) == "failover"
    # Both exhausted -> waiting out one lock TTL, not stuck forever.
    assert sup.ready_to_spawn(now=1) is None
    assert sup.ready_to_spawn(now=1 + config.LOCK_TTL + 1) is not None


def test_repeated_crash_on_selected_terminal_fails_over_to_sibling():
    """Simulates the selected terminal being closed: main.py's EXIT_IPC
    circuit breaker exits repeatedly -> supervisor must switch to the other
    running terminal rather than retrying the dead one forever."""
    sup = AccountSupervisor(7948784, [MT7, MT8], primary=MT7)
    sup.active_path = MT7
    for _ in range(2):
        action = sup.record_exit(MT7, 40, lock_healthy=False, now=0)  # EXIT_IPC-style crash
        assert action == "crash-backoff"
    action = sup.record_exit(MT7, 40, lock_healthy=False, now=0)
    assert action == "crash-failover"
    assert sup.ready_to_spawn(now=0) == MT8  # failed over, no more waiting on MT7


def test_stopping_unselected_duplicate_terminal_does_not_affect_selected_bridge():
    """MT8 (not elected) closing has nothing to do with MT7's supervision —
    the supervisor never spawned anything for MT8 in the first place."""
    sup = AccountSupervisor(7948784, [MT7, MT8], primary=MT7)
    assert sup.ready_to_spawn(now=0) == MT7
    # No record_exit call for MT8 is possible — it was never a running child.
    assert sup.active_path == MT7
    assert sup.ready_to_spawn(now=1) == MT7  # still alive per the caller's poll(), untouched


def test_two_supervisors_racing_the_same_login_are_still_caught_by_the_bridge_lock():
    """At the pure-decision layer this is just: whichever candidate this
    supervisor picks, if a SEPARATE supervisor's bridge already holds a
    healthy lock for the same login, this one's spawn attempt loses and
    fails over — it never assumes it's the only supervisor in existence."""
    sup = AccountSupervisor(7948784, [MT7])
    sup.active_path = MT7
    action = sup.record_exit(MT7, EXIT_DUPLICATE, lock_healthy=True, now=0)
    assert action == "failover"
    # Only candidate, now exhausted -> waits, doesn't crash-loop.
    assert sup.ready_to_spawn(now=0) is None


# ── --broker-offset (Bug A fix: bridge_v2 must know each login's UTC offset) ──
def test_parse_broker_offsets_accepts_login_equals_minutes():
    assert _parse_broker_offsets(["7948784=180", "7954220=180"]) == {
        7948784: 180,
        7954220: 180,
    }


def test_parse_broker_offsets_empty_input_is_empty_dict():
    assert _parse_broker_offsets(None) == {}
    assert _parse_broker_offsets([]) == {}


def test_parse_broker_offsets_rejects_missing_equals():
    with pytest.raises(argparse.ArgumentTypeError):
        _parse_broker_offsets(["7948784"])


def test_parse_broker_offsets_rejects_non_integer_minutes():
    with pytest.raises(argparse.ArgumentTypeError):
        _parse_broker_offsets(["7948784=not-a-number"])


def test_spawn_command_includes_broker_utc_offset_minutes(monkeypatch):
    """_spawn must pass the offset through to the child's CLI args — never
    launches a real subprocess here, only inspects the constructed command."""
    captured = {}

    class FakePopen:
        def __init__(self, cmd, **kwargs):
            captured["cmd"] = cmd

    monkeypatch.setattr("bridge_v2.run_all_v2.subprocess.Popen", FakePopen)
    _spawn(r"C:\MT7\terminal64.exe", "redis://x", "2025-01-01T00:00:00", 180)

    cmd = captured["cmd"]
    assert "--broker-utc-offset-minutes" in cmd
    assert cmd[cmd.index("--broker-utc-offset-minutes") + 1] == "180"
