"""bridge_v2 supervisor — one bridge child per MT5 ACCOUNT, not per terminal.

Does ONLY process supervision:
  * discover approved portable terminals, filter to already-running processes
  * probe each running terminal's real MT5 login with a short-lived connect
    (no long-running bridge yet)
  * group terminal paths by login, elect exactly ONE candidate per account
    before spawning anything
  * spawn one V2 bridge child for the elected candidate
  * on that child's exit, classify why (duplicate login vs. crash) and either
    fail over to a sibling candidate or apply bounded backoff — never both
    candidates permanently unserved
  * stop children cleanly on signal

Why election, not "spawn both and let the Redis lock sort it out": two
terminals logged into the SAME account (e.g. MT7 and MT8 both on 7948784) can
both hit the lock in the same instant, or hit a lock that's mid-expiry from a
previous test run. Racing both into exit code 20 is a real failure mode:
whichever "wins" is undefined, and if both lose to a stale/expiring lock the
account ends up with NO running bridge at all. The Redis login lock inside
the bridge (main.py) remains the final safety net for cases this supervisor
truly cannot see (another supervisor instance, a manually-run bridge, a race
this process's own polling missed) — it is not the primary dedup mechanism.

It does NOT touch history cursors or mutate any Redis history state.
The old bridge/run_all.py is left untouched. Never launches, stops, restarts,
or kills any terminal64.exe process — only its own spawned bridge children.
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

from . import config
from .main import EXIT_DUPLICATE
from .mt5_client import Mt5Client, login_of, terminal_process_is_running

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("run_all_v2")

BACKOFF_BASE = 2.0
BACKOFF_MAX = 60.0
CRASH_FAILOVER_THRESHOLD = 3  # repeated non-duplicate crashes on one candidate -> try the sibling
HEARTBEAT_FRESHNESS_FACTOR = 2.0  # heartbeat considered stale after this many TTL periods


def backoff_delay(failures: int) -> float:
    """Bounded exponential backoff. failures=1 -> 2s, 2 -> 4s, ... capped at 60s."""
    return min(BACKOFF_MAX, BACKOFF_BASE ** max(1, failures))


def is_duplicate_exit(returncode: int | None) -> bool:
    """True when a child's exit means 'another bridge already owns this login'.

    That can be a deliberate, correct lock decision — or a stale/transitional
    lock. `lock_owner_healthy` (checked by the caller) tells them apart.
    """
    return returncode == EXIT_DUPLICATE


def normalize_terminal_path(path: str) -> str:
    """Canonical dict key for a terminal path — same terminal, any casing/slashes,
    must map to the same supervised child."""
    from .terminal_discovery import _dedupe_terminal_key

    return _dedupe_terminal_key(path)


def lock_owner_healthy(lock_value, heartbeat: dict | None, now: float,
                       heartbeat_ttl: float = 10.0,
                       freshness_factor: float = HEARTBEAT_FRESHNESS_FACTOR) -> bool:
    """True when a login's Redis lock reflects a genuinely live owner.

    A lock key can exist with no fresh heartbeat behind it — e.g. the owner
    died right before its lock TTL expired, or two processes started within
    the same instant. That is NOT a healthy duplicate: retrying the same
    candidate after the lock's own TTL clears is correct. Only a lock backed
    by a recent heartbeat means "yield to this owner, try someone else."
    """
    if not lock_value or not heartbeat:
        return False
    try:
        last_seen = float(heartbeat.get("lastSeen", 0))
    except (TypeError, ValueError):
        return False
    return (now - last_seen) < heartbeat_ttl * freshness_factor


def check_lock_health(redis_client, login: int, now: float) -> bool:
    """Redis-backed wrapper around lock_owner_healthy. Read-only — never
    mutates the login lock or heartbeat keys."""
    lock_value = redis_client.get(config.key_lock(login))
    heartbeat = redis_client.hgetall(config.key_heartbeat(login))
    return lock_owner_healthy(lock_value, heartbeat, now)


def discover() -> list[str]:
    """Approved portable terminals, via the existing discovery module."""
    from .terminal_discovery import discover_terminal_paths

    return discover_terminal_paths()


def running_only(paths: list[str]) -> list[str]:
    """Filter approved terminals down to ones actually running right now.
    Read-only process check — never launches or stops anything."""
    return [p for p in paths if terminal_process_is_running(p)]


def probe_login(terminal_path: str, client_factory=Mt5Client) -> int | None:
    """Short-lived connect+account_info+shutdown to learn a terminal's real
    MT5 login, WITHOUT starting a long-running bridge. Returns None (and
    logs) on any failure — an unprobeable terminal is excluded as a
    candidate rather than guessed about.
    """
    client = client_factory(terminal_path)
    try:
        client.initialize()
        acct = client.account_info()
        if not acct.ok:
            log.warning("login probe failed for %s: %s", terminal_path, acct.describe())
            return None
        return login_of(acct.value)
    except Exception as exc:
        log.warning("login probe error for %s: %s", terminal_path, exc)
        return None
    finally:
        client.shutdown()


def group_candidates_by_login(paths: list[str], client_factory=Mt5Client) -> dict[int, dict[str, str]]:
    """normalized_path -> real_path, grouped by probed MT5 login."""
    groups: dict[int, dict[str, str]] = {}
    for real_path in paths:
        login = probe_login(real_path, client_factory)
        if login is None:
            continue
        groups.setdefault(login, {})[normalize_terminal_path(real_path)] = real_path
    return groups


class AccountSupervisor:
    """Pure election/failover decision state for ONE MT5 login. No I/O — the
    caller injects exit codes, lock health, and the current time; this class
    only decides what should happen next. Kept I/O-free so tests exercise the
    exact production decision logic, not a paraphrase of it.
    """

    def __init__(self, login: int, candidates: list[str], primary: str | None = None):
        self.login = login
        self.candidates = list(candidates)  # normalized paths, stable order
        self.primary = primary
        self.tried: set[str] = set()        # ruled out this epoch (healthy rival owner, or crash-failover)
        self.active_path: str | None = None
        self.failures: dict[str, int] = {}
        self.next_start: dict[str, float] = {}
        self.give_up_until: float = 0.0

    def _untried(self) -> list[str]:
        return [c for c in self.candidates if c not in self.tried]

    def elect(self) -> str | None:
        """Pick a candidate: sticky to the current active path if still
        viable, else the configured primary, else lexicographically first."""
        untried = self._untried()
        if not untried:
            return None
        if self.active_path in untried:
            return self.active_path
        if self.primary in untried:
            return self.primary
        return sorted(untried)[0]

    def _rule_out(self, path: str, now: float) -> None:
        """Remove a candidate from this epoch's election. If every candidate
        has now lost once, don't spin forever — wait one lock TTL then let
        the whole group try again."""
        self.tried.add(path)
        if not self._untried():
            self.tried.clear()
            self.give_up_until = now + config.LOCK_TTL

    def record_exit(self, path: str, returncode: int | None, lock_healthy: bool, now: float) -> str:
        """Classify one child's exit and update state. Returns an action tag."""
        self.active_path = None
        if is_duplicate_exit(returncode):
            if lock_healthy:
                # A real, live owner holds this login's lock elsewhere — this
                # candidate loses the election; try a sibling.
                self._rule_out(path, now)
                return "failover"
            # Lock key present but no fresh heartbeat behind it: a stale or
            # transitional lock, not a real rival. Retry the SAME candidate
            # once the lock's own TTL has had time to clear.
            self.next_start[path] = now + config.LOCK_TTL
            return "stale-lock-retry"

        # Any other exit (crash, EXIT_IPC from a closed terminal, etc.).
        self.failures[path] = self.failures.get(path, 0) + 1
        if self.failures[path] >= CRASH_FAILOVER_THRESHOLD:
            # This candidate keeps failing for reasons unrelated to the lock
            # (e.g. its terminal was closed) — stop retrying it and let a
            # sibling terminal take over the account.
            self._rule_out(path, now)
            self.failures.pop(path, None)
            return "crash-failover"
        self.next_start[path] = now + backoff_delay(self.failures[path])
        return "crash-backoff"

    def ready_to_spawn(self, now: float) -> str | None:
        if now < self.give_up_until:
            return None
        path = self.elect()
        if path is None:
            return None
        if now < self.next_start.get(path, 0.0):
            return None
        self.active_path = path
        return path


def _spawn(terminal_path: str, redis_url: str, from_date: str, broker_utc_offset_minutes: int) -> subprocess.Popen:
    cmd = [
        sys.executable, "-m", "bridge_v2.main",
        "--terminal-path", terminal_path,
        "--redis-url", redis_url,
        "--from-date", from_date,
        "--broker-utc-offset-minutes", str(broker_utc_offset_minutes),
    ]
    log.info("spawn: %s", terminal_path)
    return subprocess.Popen(cmd, cwd=str(Path(__file__).resolve().parent.parent))


def run(terminals: list[str], redis_url: str, from_date: str, primaries: dict[int, str] | None = None,
        broker_offsets: dict[int, int] | None = None) -> None:
    import redis as redislib  # type: ignore[import]

    r = redislib.from_url(redis_url, decode_responses=True)
    r.ping()

    candidates = running_only(terminals)
    groups = group_candidates_by_login(candidates)
    primaries = primaries or {}
    broker_offsets = broker_offsets or {}

    accounts: dict[int, AccountSupervisor] = {}
    paths_by_login: dict[int, dict[str, str]] = {}
    for login, norm_to_real in groups.items():
        if login not in broker_offsets:
            log.error(
                "account=%s has no --broker-offset configured — refusing to supervise "
                "rather than guess a UTC offset. candidates=%s",
                login, sorted(norm_to_real.values()),
            )
            continue
        paths_by_login[login] = norm_to_real
        primary = normalize_terminal_path(primaries[login]) if login in primaries else None
        accounts[login] = AccountSupervisor(login, sorted(norm_to_real), primary=primary)
        log.info("account=%s candidates=%s", login, sorted(norm_to_real.values()))

    children: dict[int, subprocess.Popen] = {}
    stop = threading.Event()

    def _stop(sig, frame):
        log.info("signal %s -> stopping children", sig)
        stop.set()

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    try:
        while not stop.is_set():
            now = time.monotonic()
            for login, sup in accounts.items():
                proc = children.get(login)
                if proc is not None and proc.poll() is None:
                    continue  # alive

                if proc is not None:
                    exited_path = sup.active_path
                    lock_healthy = False
                    if is_duplicate_exit(proc.returncode):
                        lock_healthy = check_lock_health(r, login, time.time())
                    action = sup.record_exit(exited_path, proc.returncode, lock_healthy, now)
                    children.pop(login, None)
                    if action == "failover":
                        log.error(
                            "account=%s skipped_duplicate_terminal=%s (healthy external owner)",
                            login, exited_path,
                        )
                    elif action == "crash-failover":
                        log.error(
                            "account=%s skipped_duplicate_terminal=%s (repeated failure — failing over)",
                            login, exited_path,
                        )
                    elif action == "stale-lock-retry":
                        log.warning(
                            "account=%s terminal=%s exited rc=20 but lock has no fresh "
                            "heartbeat — treating as stale, will retry.", login, exited_path,
                        )
                    else:
                        log.warning(
                            "account=%s terminal=%s crashed rc=%s — bounded backoff.",
                            login, exited_path, proc.returncode,
                        )
                    continue

                path = sup.ready_to_spawn(now)
                if path is None:
                    continue
                real_path = paths_by_login[login][path]
                log.info("account=%s selected=%s", login, real_path)
                children[login] = _spawn(real_path, redis_url, from_date, broker_offsets[login])
            stop.wait(2.0)
    finally:
        for login, proc in children.items():
            if proc.poll() is None:
                log.info("terminating child: account=%s", login)
                proc.terminate()
        deadline = time.time() + 10
        for proc in children.values():
            remaining = max(0.0, deadline - time.time())
            try:
                proc.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                proc.kill()
        log.info("run_all_v2 stopped")


def _parse_primary_terminals(values: list[str] | None) -> dict[int, str]:
    """--primary-terminal '7948784=C:\\MT7\\terminal64.exe', repeatable."""
    primaries: dict[int, str] = {}
    for raw in values or ():
        login_str, _, path = raw.partition("=")
        if not path:
            raise argparse.ArgumentTypeError(f"expected LOGIN=PATH, got: {raw!r}")
        primaries[int(login_str)] = path
    return primaries


def _parse_broker_offsets(values: list[str] | None) -> dict[int, int]:
    """--broker-offset '7948784=180', repeatable. TradingAccount.brokerUtcOffsetMinutes
    per login — see scripts/set-broker-utc-offset.ts for the operator-facing source of
    truth; keep this list in sync with it manually (bridge_v2 stays DB-free by design)."""
    offsets: dict[int, int] = {}
    for raw in values or ():
        login_str, _, minutes_str = raw.partition("=")
        if not minutes_str:
            raise argparse.ArgumentTypeError(f"expected LOGIN=MINUTES, got: {raw!r}")
        try:
            offsets[int(login_str)] = int(minutes_str)
        except ValueError:
            raise argparse.ArgumentTypeError(f"expected LOGIN=MINUTES (integers), got: {raw!r}")
    return offsets


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="bridge_v2 supervisor (account-level election)")
    parser.add_argument("--redis-url", default=os.environ.get("REDIS_URL", "redis://127.0.0.1:6379"))
    parser.add_argument("--from-date", default=config.DEFAULT_HISTORY_START_ISO)
    parser.add_argument("--terminal-path", action="append", help="Explicit terminal path; repeat. Skips discovery.")
    parser.add_argument("--primary-terminal", action="append", metavar="LOGIN=PATH",
                        help="Preferred terminal path for a login when multiple candidates exist. Repeatable.")
    parser.add_argument("--broker-offset", action="append", metavar="LOGIN=MINUTES",
                        help="TradingAccount.brokerUtcOffsetMinutes for a login (e.g. 7948784=180). "
                             "Repeatable. Required per login — an account missing here is not "
                             "supervised (see run()'s refusal log line).")
    args = parser.parse_args(argv)

    terminals = args.terminal_path or discover()
    if not terminals:
        log.error("no approved portable terminals found")
        return 1
    log.info("supervising %d terminal(s)", len(terminals))
    run(terminals, args.redis_url, args.from_date, _parse_primary_terminals(args.primary_terminal),
        _parse_broker_offsets(args.broker_offset))
    return 0


if __name__ == "__main__":
    sys.exit(main())
