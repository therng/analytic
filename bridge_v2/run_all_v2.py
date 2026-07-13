"""bridge_v2 supervisor — spawn one V2 bridge per approved portable terminal.

Does ONLY process supervision:
  * discover approved portable terminals (reuses bridge/discover_terminals.py)
  * spawn one V2 bridge per terminal, passing the explicit terminal path
  * prevent duplicate processes (one child per normalized terminal path)
  * restart failed children with bounded exponential backoff
  * treat a child exit code 20 (duplicate MT5 login) as terminal — never
    respawn it; other terminal paths keep being supervised normally
  * stop children cleanly on signal

It does NOT touch history cursors or mutate any Redis history state.
The old bridge/run_all.py is left untouched.
"""

from __future__ import annotations

import argparse
import logging
import ntpath
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("run_all_v2")

BACKOFF_BASE = 2.0
BACKOFF_MAX = 60.0
EXIT_DUPLICATE = 20  # must match bridge_v2.main.EXIT_DUPLICATE


def backoff_delay(failures: int) -> float:
    """Bounded exponential backoff. failures=1 -> 2s, 2 -> 4s, ... capped at 60s."""
    return min(BACKOFF_MAX, BACKOFF_BASE ** max(1, failures))


def normalize_terminal_path(path: str) -> str:
    """Canonical dict key for a terminal path — same terminal, any casing/slashes,
    must map to the same supervised child (matches bridge/discover_terminals.py)."""
    return ntpath.normcase(ntpath.normpath(path.strip()))


def is_duplicate_exit(returncode: int | None) -> bool:
    """True when a child's exit means 'another bridge already owns this login'.

    That is a deliberate, correct outcome of the Redis login lock — not a
    crash. Feeding it through the crash-retry path would spawn a process that
    immediately loses the lock race again, forever.
    """
    return returncode == EXIT_DUPLICATE


def discover() -> list[str]:
    """Approved portable terminals, via the existing discovery module."""
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bridge"))
    from discover_terminals import discover_terminal_paths  # type: ignore[import]

    return discover_terminal_paths()


def _spawn(terminal_path: str, redis_url: str, from_date: str) -> subprocess.Popen:
    cmd = [
        sys.executable, "-m", "bridge_v2.main",
        "--terminal-path", terminal_path,
        "--redis-url", redis_url,
        "--from-date", from_date,
    ]
    log.info("spawn: %s", terminal_path)
    return subprocess.Popen(cmd, cwd=str(Path(__file__).resolve().parent.parent))


def run(terminals: list[str], redis_url: str, from_date: str) -> None:
    stop = threading.Event()
    # Normalized path -> real path passed to the child (case/slash-insensitive key,
    # exact string for --terminal-path).
    paths: dict[str, str] = {}
    for real_path in terminals:
        paths.setdefault(normalize_terminal_path(real_path), real_path)

    children: dict[str, subprocess.Popen] = {}
    failures: dict[str, int] = {}
    next_start: dict[str, float] = {}
    duplicate_stopped: set[str] = set()  # intentional exit code 20 — never auto-respawn

    def _stop(sig, frame):
        log.info("signal %s -> stopping children", sig)
        stop.set()

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    try:
        while not stop.is_set():
            now = time.monotonic()
            for norm_path, real_path in paths.items():
                if norm_path in duplicate_stopped:
                    continue  # duplicate login is a deliberate stop, not a crash to retry
                proc = children.get(norm_path)
                if proc is not None and proc.poll() is None:
                    continue  # alive; duplicate spawn prevented
                if proc is not None:
                    if is_duplicate_exit(proc.returncode):
                        # The bridge itself detected another owner of this login's
                        # Redis lock and exited on purpose. Respawning here would
                        # just race the lock forever — the lock already does its
                        # job; retrying is pure noise, not resilience.
                        log.error(
                            "terminal_path=%s exit_code=%d reason=duplicate MT5 account "
                            "already owns the Redis login lock — not restarting; "
                            "other terminals continue supervision unaffected.",
                            norm_path, EXIT_DUPLICATE,
                        )
                        duplicate_stopped.add(norm_path)
                        children.pop(norm_path, None)
                        continue
                    failures[norm_path] = failures.get(norm_path, 0) + 1
                    delay = backoff_delay(failures[norm_path])
                    log.warning("child exited rc=%s (%s) — restart in %.0fs", proc.returncode, norm_path, delay)
                    next_start[norm_path] = now + delay
                    children.pop(norm_path, None)
                    continue
                if now < next_start.get(norm_path, 0.0):
                    continue
                children[norm_path] = _spawn(real_path, redis_url, from_date)
            stop.wait(2.0)
    finally:
        for path, proc in children.items():
            if proc.poll() is None:
                log.info("terminating child: %s", path)
                proc.terminate()
        deadline = time.time() + 10
        for proc in children.values():
            remaining = max(0.0, deadline - time.time())
            try:
                proc.wait(timeout=remaining)
            except subprocess.TimeoutExpired:
                proc.kill()
        log.info("run_all_v2 stopped")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="bridge_v2 supervisor")
    parser.add_argument("--redis-url", default=os.environ.get("REDIS_URL", "redis://127.0.0.1:6379"))
    parser.add_argument("--from-date", default=os.environ.get("V2_HISTORY_START", "2026-01-01T00:00:00"))
    parser.add_argument("--terminal-path", action="append", help="Explicit terminal path; repeat. Skips discovery.")
    args = parser.parse_args(argv)

    terminals = args.terminal_path or discover()
    if not terminals:
        log.error("no approved portable terminals found")
        return 1
    log.info("supervising %d terminal(s)", len(terminals))
    run(terminals, args.redis_url, args.from_date)
    return 0


if __name__ == "__main__":
    sys.exit(main())
