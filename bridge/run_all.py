"""
Launch one mt5_bridge.py process per discovered portable MT5 terminal.

Usage:
  set REDIS_URL=redis://:password@127.0.0.1:6379
  python run_all.py

  # or with explicit URL:
  python run_all.py --redis-url redis://:password@127.0.0.1:6379

Processes restart automatically if they exit unexpectedly.
Stop with Ctrl+C.
"""

import argparse
import logging
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

BRIDGE_SCRIPT = Path(__file__).parent / "mt5_bridge.py"
RESTART_DELAY = 5  # seconds before restarting a dead process


def main(redis_url: str) -> None:
    from discover_terminals import discover_terminal_paths

    paths = discover_terminal_paths()
    if not paths:
        log.error("No portable MT5 terminals found in Startup folder. Exiting.")
        sys.exit(1)

    log.info("Discovered %d terminal(s): %s", len(paths), paths)

    # pid → terminal_path mapping for restart tracking
    procs: dict[int, str] = {}

    def spawn(terminal_path: str) -> subprocess.Popen:
        p = subprocess.Popen(
            [sys.executable, str(BRIDGE_SCRIPT),
             "--terminal-path", terminal_path,
             "--redis-url", redis_url],
            cwd=str(Path(__file__).parent),
        )
        log.info("Spawned PID %d for %s", p.pid, terminal_path)
        return p

    processes: list[subprocess.Popen] = [spawn(path) for path in paths]
    for p, path in zip(processes, paths):
        procs[p.pid] = path

    def shutdown(sig, frame):
        log.info("Shutting down all bridge processes...")
        for p in processes:
            try:
                p.terminate()
            except Exception:
                pass
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    while True:
        time.sleep(RESTART_DELAY)
        for i, (p, path) in enumerate(zip(processes, paths)):
            if p.poll() is not None:
                log.warning("Bridge for %s exited (code=%s). Restarting...", path, p.returncode)
                new_p = spawn(path)
                processes[i] = new_p
                procs[new_p.pid] = path


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
