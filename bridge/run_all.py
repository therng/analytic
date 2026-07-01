"""
Launch one mt5_bridge.py process per discovered portable MT5 terminal.

Usage:
  set REDIS_URL=redis://:password@127.0.0.1:6379
  python run_all.py

  # or with explicit URL:
  python run_all.py --redis-url redis://:password@127.0.0.1:6379

Each terminal gets its own exponential backoff sequence so one broken
terminal (bad login, closed window, etc.) can't restart-loop the whole
fleet. Startup is batched and jittered to avoid every terminal calling
mt5.initialize() at the same instant.

Stop with Ctrl+C. On Windows, children are asked to shut down gracefully
via CTRL_BREAK_EVENT (so they can release their Redis lock) before being
force-killed.
"""

import argparse
import logging
import os
import random
import signal
import subprocess
import sys
import time
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

BACKOFF_SEQUENCE = [1, 2, 4, 8, 16, 30, 60, 120]
# A process that stays up at least this long is considered "healthy" and
# its backoff resets to the start of the sequence on its next exit.
BACKOFF_RESET_AFTER = float(os.environ.get("BACKOFF_RESET_AFTER", "60"))
MAX_STARTUP_PARALLEL = int(os.environ.get("MAX_STARTUP_PARALLEL", "2"))
STARTUP_BATCH_WAIT = float(os.environ.get("STARTUP_BATCH_WAIT", "3"))
STARTUP_JITTER_MAX = float(os.environ.get("STARTUP_JITTER_MAX", "3"))
TICK_SECONDS = 1.0

IS_WINDOWS = os.name == "nt"


class TerminalProc:
    def __init__(self, path: str) -> None:
        self.path = path
        self.proc: subprocess.Popen | None = None
        self.backoff_index = 0
        self.next_spawn_at: float = 0.0
        self.started_at: float = 0.0


def _spawn(term: TerminalProc, redis_url: str) -> None:
    jitter = random.uniform(0, STARTUP_JITTER_MAX)
    kwargs: dict = {"cwd": str(Path(__file__).parent)}
    if IS_WINDOWS:
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    term.proc = subprocess.Popen(
        [
            sys.executable, str(BRIDGE_SCRIPT),
            "--terminal-path", term.path,
            "--redis-url", redis_url,
            "--startup-jitter", f"{jitter:.2f}",
        ],
        **kwargs,
    )
    term.started_at = time.monotonic()
    log.info("Spawned PID %d for %s (jitter=%.2fs)", term.proc.pid, term.path, jitter)


def _schedule_restart(term: TerminalProc) -> None:
    uptime = time.monotonic() - term.started_at
    if uptime >= BACKOFF_RESET_AFTER:
        term.backoff_index = 0
    else:
        term.backoff_index = min(term.backoff_index + 1, len(BACKOFF_SEQUENCE) - 1)
    delay = BACKOFF_SEQUENCE[term.backoff_index]
    term.next_spawn_at = time.monotonic() + delay
    log.warning(
        "Bridge for %s exited (code=%s, uptime=%.1fs). Restarting in %ds (backoff step %d/%d).",
        term.path, term.proc.returncode if term.proc else "?", uptime, delay,
        term.backoff_index + 1, len(BACKOFF_SEQUENCE),
    )


def _graceful_stop(term: TerminalProc, timeout: float = 8.0) -> None:
    p = term.proc
    if p is None or p.poll() is not None:
        return
    try:
        if IS_WINDOWS:
            p.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            p.terminate()
        p.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        log.warning("PID %d did not exit within %.0fs, killing.", p.pid, timeout)
        p.kill()
    except Exception:
        pass


def main(redis_url: str) -> None:
    from discover_terminals import discover_terminal_paths

    paths = discover_terminal_paths()
    if not paths:
        log.error("No portable MT5 terminals found in Startup folder. Exiting.")
        sys.exit(1)

    log.info("Discovered %d terminal(s): %s", len(paths), paths)

    terminals = [TerminalProc(path) for path in paths]

    # Batch the initial startup so we don't fire mt5.initialize() for every
    # terminal at the exact same instant.
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
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    while True:
        time.sleep(TICK_SECONDS)
        now = time.monotonic()
        for term in terminals:
            if term.proc is not None and term.proc.poll() is not None:
                _schedule_restart(term)
                term.proc = None
            elif term.proc is None and term.next_spawn_at and now >= term.next_spawn_at:
                term.next_spawn_at = 0.0
                _spawn(term, redis_url)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Launch all MT5 bridge processes")
    parser.add_argument(
        "--redis-url",
        default=os.environ.get("REDIS_URL", "redis://127.0.0.1:6379"),
        help="Redis URL (or set REDIS_URL env var)",
    )
    args = parser.parse_args()

    if not args.redis_url:
        log.error("REDIS_URL not set. Use --redis-url or set REDIS_URL env var.")
        sys.exit(1)

    main(args.redis_url)
