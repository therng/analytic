"""
Launch one mt5_bridge.py process per discovered portable MT5 terminal.

Usage:
  set REDIS_URL=redis://:password@127.0.0.1:6379
  python run_all.py

Supervisor policy per bridge exit code:
  EXIT_OK        0   — clean shutdown; no restart unless we didn't initiate it
  EXIT_DUPLICATE 20  — another bridge owns this login; wait for heartbeat to
                       expire (≤ HEARTBEAT_TTL s), then respawn immediately
  EXIT_AUTH      30  — terminal not logged in; retry after AUTH_RETRY_DELAY (10 min)
  EXIT_IPC       40  — MT5 IPC overload; exponential backoff + jitter
  EXIT_REDIS     50  — Redis down; quick retry (short fixed delay)
  EXIT_FATAL     99  — bad terminal path or unrecoverable error; exponential backoff
  other/unknown       — treat as EXIT_FATAL
"""

import argparse
import logging
import os
import random
import signal
import subprocess
import sys
import time
from enum import Enum
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

BRIDGE_SCRIPT = Path(__file__).parent / "mt5_bridge.py"

# ── Exit codes (mirror mt5_bridge.py) ─────────────────────────────────────────
EXIT_OK        = 0
EXIT_DUPLICATE = 20
EXIT_AUTH      = 30
EXIT_IPC       = 40
EXIT_REDIS     = 50
EXIT_FATAL     = 99

# ── Config ─────────────────────────────────────────────────────────────────────
BACKOFF_SEQUENCE    = [1, 2, 4, 8, 16, 30, 60, 120]
BACKOFF_JITTER      = float(os.environ.get("BACKOFF_JITTER",       "0.2"))   # ±20%
BACKOFF_RESET_AFTER = float(os.environ.get("BACKOFF_RESET_AFTER",  "60"))    # uptime threshold for reset
AUTH_RETRY_DELAY    = float(os.environ.get("AUTH_RETRY_DELAY",     "600"))   # 10 min before retrying auth
REDIS_RETRY_DELAY   = float(os.environ.get("REDIS_RETRY_DELAY",    "5"))     # quick retry for Redis down
HEARTBEAT_TTL       = int(os.environ.get("HEARTBEAT_TTL",          "10"))    # must match bridge setting
MAX_STARTUP_PARALLEL= int(os.environ.get("MAX_STARTUP_PARALLEL",   "2"))
STARTUP_BATCH_WAIT  = float(os.environ.get("STARTUP_BATCH_WAIT",   "3"))
STARTUP_JITTER_MAX  = float(os.environ.get("STARTUP_JITTER_MAX",   "3"))
SPAWN_RATE_LIMIT    = int(os.environ.get("SPAWN_RATE_LIMIT",        "2"))    # max spawns per SPAWN_RATE_WINDOW
SPAWN_RATE_WINDOW   = float(os.environ.get("SPAWN_RATE_WINDOW",    "3"))     # seconds
TICK_SECONDS        = 1.0
HB_CHECK_INTERVAL   = float(os.environ.get("HB_CHECK_INTERVAL",    "15"))   # how often to check heartbeat health

IS_WINDOWS = os.name == "nt"


class TerminalState(Enum):
    DISCOVERED  = "discovered"   # initial state, not yet spawned
    STARTING    = "starting"     # process spawned, not yet confirmed running
    RUNNING     = "running"      # process alive and heartbeat healthy
    BACKOFF     = "backoff"      # waiting before next spawn attempt
    DUPLICATE   = "duplicate"    # another bridge owns this login; waiting for its heartbeat to expire
    AUTH_FAILED = "auth_failed"  # not logged in; waiting for manual fix
    IPC_FAILED  = "ipc_failed"   # MT5 IPC circuit breaker; in backoff
    STOPPING    = "stopping"     # graceful shutdown in progress


class TerminalProc:
    def __init__(self, path: str) -> None:
        self.path          = path
        self.proc: subprocess.Popen | None = None
        self.state         = TerminalState.DISCOVERED
        self.login: str | None = None          # filled in once we learn it from Redis
        self.backoff_index = 0
        self.next_spawn_at = 0.0
        self.started_at    = 0.0
        self.last_hb_check = 0.0


def _jittered_delay(base: float) -> float:
    lo = base * (1 - BACKOFF_JITTER)
    hi = base * (1 + BACKOFF_JITTER)
    return random.uniform(lo, hi)


# ── Global spawn rate limiter ──────────────────────────────────────────────────
_recent_spawns: list[float] = []


def _can_spawn() -> bool:
    now = time.monotonic()
    cutoff = now - SPAWN_RATE_WINDOW
    while _recent_spawns and _recent_spawns[0] < cutoff:
        _recent_spawns.pop(0)
    return len(_recent_spawns) < SPAWN_RATE_LIMIT


def _record_spawn() -> None:
    _recent_spawns.append(time.monotonic())


def _spawn(term: TerminalProc, redis_url: str) -> None:
    jitter = random.uniform(0, STARTUP_JITTER_MAX)
    kwargs: dict = {"cwd": str(Path(__file__).parent)}
    if IS_WINDOWS:
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    term.proc = subprocess.Popen(
        [
            sys.executable, str(BRIDGE_SCRIPT),
            "--terminal-path", term.path,
            "--redis-url",     redis_url,
            "--startup-jitter", f"{jitter:.2f}",
        ],
        **kwargs,
    )
    term.started_at    = time.monotonic()
    term.state         = TerminalState.STARTING
    term.next_spawn_at = 0.0
    _record_spawn()
    log.info("Spawned PID %d for %s (jitter=%.2fs)", term.proc.pid, term.path, jitter)


def _schedule_restart(term: TerminalProc, redis_url: str, r) -> None:
    """Decide what to do after a bridge process exits, based on its exit code."""
    code   = term.proc.returncode if term.proc else None
    uptime = time.monotonic() - term.started_at

    if code == EXIT_OK:
        log.info("Bridge for %s exited cleanly (uptime=%.1fs). Restarting.", term.path, uptime)
        _backoff_restart(term, uptime, fast=True)
        return

    if code == EXIT_DUPLICATE:
        # Another bridge owns this login. Wait for its heartbeat to expire,
        # then respawn. We look up the login via the pid→login key in Redis.
        pid = str(term.proc.pid) if term.proc else None
        login = None
        if pid and r:
            try:
                login = r.get(f"mt5:bridge:pid:{pid}")
            except Exception:
                pass
        term.login = login or term.login
        term.state = TerminalState.DUPLICATE
        term.next_spawn_at = time.monotonic() + HEARTBEAT_TTL + 1
        log.info(
            "Bridge for %s is DUPLICATE (login=%s). Waiting %ds for heartbeat to expire.",
            term.path, term.login or "?", HEARTBEAT_TTL + 1,
        )
        return

    if code == EXIT_AUTH:
        term.state = TerminalState.AUTH_FAILED
        term.next_spawn_at = time.monotonic() + AUTH_RETRY_DELAY
        log.warning(
            "Bridge for %s AUTH_FAILED (uptime=%.1fs). Retrying in %.0fs.",
            term.path, uptime, AUTH_RETRY_DELAY,
        )
        return

    if code == EXIT_REDIS:
        term.state = TerminalState.BACKOFF
        term.next_spawn_at = time.monotonic() + REDIS_RETRY_DELAY
        log.warning(
            "Bridge for %s Redis failure (uptime=%.1fs). Retrying in %.0fs.",
            term.path, uptime, REDIS_RETRY_DELAY,
        )
        return

    if code == EXIT_IPC:
        term.state = TerminalState.IPC_FAILED
        _backoff_restart(term, uptime)
        return

    # EXIT_FATAL or unknown
    _backoff_restart(term, uptime)


def _backoff_restart(term: TerminalProc, uptime: float, fast: bool = False) -> None:
    if fast or uptime >= BACKOFF_RESET_AFTER:
        term.backoff_index = 0
    else:
        term.backoff_index = min(term.backoff_index + 1, len(BACKOFF_SEQUENCE) - 1)
    base  = BACKOFF_SEQUENCE[term.backoff_index]
    delay = _jittered_delay(base)
    term.state         = TerminalState.BACKOFF
    term.next_spawn_at = time.monotonic() + delay
    log.warning(
        "Bridge for %s exited (code=%s, uptime=%.1fs). Restarting in %.1fs (backoff step %d/%d).",
        term.path,
        term.proc.returncode if term.proc else "?",
        uptime, delay,
        term.backoff_index + 1, len(BACKOFF_SEQUENCE),
    )


def _graceful_stop(term: TerminalProc, timeout: float = 8.0) -> None:
    p = term.proc
    if p is None or p.poll() is not None:
        return
    term.state = TerminalState.STOPPING
    try:
        if IS_WINDOWS:
            p.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            p.terminate()
        p.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        log.warning("PID %d did not exit within %.0fs, killing.", p.pid, timeout)
        p.kill()
        p.wait()
    except Exception:
        pass


def _check_heartbeat_health(term: TerminalProc, r) -> bool:
    """
    Returns True if the running bridge is healthy.
    A running process with an expired heartbeat is considered stuck.
    """
    if term.proc is None or term.state not in (TerminalState.STARTING, TerminalState.RUNNING):
        return True  # not our job to check right now
    if r is None:
        return True
    pid = str(term.proc.pid)
    try:
        login = r.get(f"mt5:bridge:pid:{pid}") or term.login
        if not login:
            return True  # too early, bridge hasn't written pid key yet
        term.login = str(login)
        heartbeat_alive = r.exists(f"mt5:bridge:heartbeat:{login}")
        if not heartbeat_alive:
            log.warning(
                "Heartbeat for login=%s (PID=%s, path=%s) is dead while process is alive — killing.",
                login, pid, term.path,
            )
            return False
        term.state = TerminalState.RUNNING
    except Exception as exc:
        log.debug("Heartbeat check error for %s: %s", term.path, exc)
    return True


def _make_redis(redis_url: str):
    try:
        import redis as redislib
        r = redislib.from_url(redis_url, decode_responses=True, socket_connect_timeout=3)
        r.ping()
        return r
    except Exception as exc:
        log.warning("Supervisor Redis connection failed: %s — heartbeat checks disabled.", exc)
        return None


def main(redis_url: str) -> None:
    from discover_terminals import discover_terminal_paths

    paths = discover_terminal_paths()
    if not paths:
        log.error("No approved portable MT5 terminals found in Startup folders. Exiting.")
        sys.exit(1)

    log.info("Discovered %d terminal(s):", len(paths))
    for path in paths:
        log.info("  %s", path)

    terminals = [TerminalProc(path) for path in paths]
    r = _make_redis(redis_url)

    # Batched initial startup with jitter
    for i in range(0, len(terminals), MAX_STARTUP_PARALLEL):
        batch = terminals[i:i + MAX_STARTUP_PARALLEL]
        for term in batch:
            _spawn(term, redis_url)
        if i + MAX_STARTUP_PARALLEL < len(terminals):
            time.sleep(STARTUP_BATCH_WAIT)

    stopping = False

    def shutdown(sig, frame):
        nonlocal stopping
        if stopping:
            return
        stopping = True
        log.info("Shutting down all bridge processes...")
        for term in terminals:
            _graceful_stop(term)
        # Wait for all children to exit
        for term in terminals:
            if term.proc and term.proc.poll() is None:
                try:
                    term.proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    term.proc.kill()
        log.info("All bridges stopped.")
        sys.exit(0)

    signal.signal(signal.SIGINT,  shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    now = time.monotonic()
    next_hb_check = now + HB_CHECK_INTERVAL

    while True:
        time.sleep(TICK_SECONDS)
        now = time.monotonic()

        # ── Heartbeat health check (periodically) ─────────────────────────────
        if now >= next_hb_check:
            next_hb_check = now + HB_CHECK_INTERVAL
            for term in terminals:
                if term.proc and term.proc.poll() is None:
                    if not _check_heartbeat_health(term, r):
                        _graceful_stop(term)

        for term in terminals:
            # ── Reap exited processes ──────────────────────────────────────────
            if term.proc is not None and term.proc.poll() is not None:
                _schedule_restart(term, redis_url, r)
                term.proc = None

            # ── DUPLICATE: poll until heartbeat expires, then respawn ──────────
            elif term.state == TerminalState.DUPLICATE and now >= term.next_spawn_at:
                login = term.login
                heartbeat_alive = False
                if login and r:
                    try:
                        heartbeat_alive = bool(r.exists(f"mt5:bridge:heartbeat:{login}"))
                    except Exception:
                        pass
                if not heartbeat_alive:
                    log.info(
                        "Heartbeat for login=%s expired. Respawning bridge for %s.",
                        login or "?", term.path,
                    )
                    term.state = TerminalState.DISCOVERED
                    if _can_spawn():
                        _spawn(term, redis_url)
                    else:
                        term.next_spawn_at = now + SPAWN_RATE_WINDOW
                else:
                    # Heartbeat still alive; check again after TTL
                    term.next_spawn_at = now + HEARTBEAT_TTL + 1

            # ── Ready to (re)spawn ─────────────────────────────────────────────
            elif (
                term.proc is None
                and term.state not in (TerminalState.DUPLICATE, TerminalState.STOPPING)
                and term.next_spawn_at > 0
                and now >= term.next_spawn_at
            ):
                if _can_spawn():
                    _spawn(term, redis_url)
                else:
                    # Rate limited: defer by one window
                    term.next_spawn_at = now + SPAWN_RATE_WINDOW


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Launch all MT5 bridge processes")
    parser.add_argument(
        "--redis-url",
        default=os.environ.get("REDIS_URL", "redis://127.0.0.1:6379"),
    )
    args = parser.parse_args()

    if not args.redis_url:
        log.error("REDIS_URL not set. Use --redis-url or set REDIS_URL env var.")
        sys.exit(1)

    main(args.redis_url)
