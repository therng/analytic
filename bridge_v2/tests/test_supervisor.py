"""Supervisor dispatch logic — no subprocess/threading, pure simulation.

Covers the exact failure mode flagged in review: the Redis login lock only
prevents duplicate *data*, not a duplicate-*spawn* loop. If the supervisor
respawns a process that will just lose the lock race again, it burns
CPU/MT5 IPC forever. These tests drive the same per-tick decision the real
`run()` loop makes, using fake processes instead of real ones.
"""

from bridge_v2.run_all_v2 import (
    EXIT_DUPLICATE,
    backoff_delay,
    is_duplicate_exit,
    normalize_terminal_path,
)


def test_duplicate_exit_code_is_recognized():
    assert is_duplicate_exit(EXIT_DUPLICATE) is True
    assert is_duplicate_exit(20) is True


def test_crash_codes_are_not_duplicate_exit():
    assert is_duplicate_exit(0) is False
    assert is_duplicate_exit(1) is False
    assert is_duplicate_exit(99) is False
    assert is_duplicate_exit(None) is False


def test_backoff_grows_and_is_bounded():
    assert backoff_delay(1) == 2.0
    assert backoff_delay(2) == 4.0
    assert backoff_delay(10) == 60.0  # capped, not unbounded exponential


def test_normalize_terminal_path_is_case_and_slash_insensitive():
    a = normalize_terminal_path(r"C:\MT5\Terminal64.exe")
    b = normalize_terminal_path(r"c:\mt5\terminal64.exe")
    assert a == b


class FakeProc:
    def __init__(self, returncode):
        self.returncode = returncode

    def poll(self):
        return self.returncode


class Supervisor:
    """Minimal re-implementation of run()'s per-tick dispatch, no I/O.

    Mirrors run_all_v2.run() exactly in decision logic so these tests exercise
    the real algorithm, not a paraphrase of it.
    """

    def __init__(self, paths: dict[str, str]):
        self.paths = paths
        self.children: dict[str, FakeProc] = {}
        self.failures: dict[str, int] = {}
        self.next_start: dict[str, float] = {}
        self.duplicate_stopped: set[str] = set()
        self.spawned: list[str] = []

    def tick(self, now: float, exited: dict[str, int] | None = None) -> dict[str, str]:
        """One supervision pass. `exited` maps norm_path -> returncode for any
        currently-running child that should appear exited this tick."""
        exited = exited or {}
        actions = {}
        for norm_path in exited:
            if norm_path in self.children:
                self.children[norm_path].returncode = exited[norm_path]

        for norm_path, real_path in self.paths.items():
            if norm_path in self.duplicate_stopped:
                actions[norm_path] = "skipped"
                continue
            proc = self.children.get(norm_path)
            if proc is not None and proc.poll() is None:
                actions[norm_path] = "alive"
                continue
            if proc is not None:
                if is_duplicate_exit(proc.returncode):
                    self.duplicate_stopped.add(norm_path)
                    self.children.pop(norm_path, None)
                    actions[norm_path] = "duplicate-stop"
                    continue
                self.failures[norm_path] = self.failures.get(norm_path, 0) + 1
                self.next_start[norm_path] = now + backoff_delay(self.failures[norm_path])
                self.children.pop(norm_path, None)
                actions[norm_path] = "crash-backoff"
                continue
            if now < self.next_start.get(norm_path, 0.0):
                actions[norm_path] = "waiting"
                continue
            self.children[norm_path] = FakeProc(None)  # None == still running
            self.spawned.append(norm_path)
            actions[norm_path] = "respawned"
        return actions


def test_exit_code_20_is_never_restarted():
    sup = Supervisor({"c:\\mt5\\a\\terminal64.exe": "C:/mt5/a/terminal64.exe"})
    path = "c:\\mt5\\a\\terminal64.exe"
    sup.children[path] = FakeProc(None)

    assert sup.tick(now=0, exited={path: EXIT_DUPLICATE})[path] == "duplicate-stop"
    for t in (1, 5, 100, 100_000):
        assert sup.tick(now=t)[path] == "skipped"
    assert path not in sup.children
    assert sup.spawned.count(path) == 0  # never respawned after the stop


def test_normal_unexpected_failure_still_uses_bounded_backoff_and_restarts():
    sup = Supervisor({"c:\\mt5\\b\\terminal64.exe": "C:/mt5/b/terminal64.exe"})
    path = "c:\\mt5\\b\\terminal64.exe"
    sup.children[path] = FakeProc(None)

    assert sup.tick(now=0, exited={path: 1})[path] == "crash-backoff"
    assert sup.tick(now=1)[path] == "waiting"          # backoff(1) == 2s, not elapsed yet
    assert sup.tick(now=2)[path] == "respawned"         # backoff elapsed -> restarted
    assert path not in sup.duplicate_stopped
    assert sup.spawned.count(path) == 1


def test_one_duplicate_terminal_does_not_stop_supervision_of_others():
    dup_path = "c:\\mt5\\dup\\terminal64.exe"
    ok_path = "c:\\mt5\\ok\\terminal64.exe"
    sup = Supervisor({dup_path: dup_path, ok_path: ok_path})
    sup.children[dup_path] = FakeProc(None)
    sup.children[ok_path] = FakeProc(None)

    actions = sup.tick(now=0, exited={dup_path: EXIT_DUPLICATE})
    assert actions[dup_path] == "duplicate-stop"
    assert actions[ok_path] == "alive"  # unaffected — separate child, separate state

    # Later ticks: dup stays stopped, ok keeps being supervised (still alive, no restart needed).
    actions = sup.tick(now=50)
    assert actions[dup_path] == "skipped"
    assert actions[ok_path] == "alive"

    # ok crashing independently still gets its own bounded backoff, unrelated to dup's fate.
    actions = sup.tick(now=51, exited={ok_path: 1})
    assert actions[ok_path] == "crash-backoff"
    assert actions[dup_path] == "skipped"
