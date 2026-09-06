# bridge

Greenfield read-only MetaTrader 5 bridge (fencing-lease Redis transport + durable SQLite journal). Package is `bridge`, importable as `import bridge`.

## Status

Runnable. `bridge/__main__.py` wires a real MT5 adapter (`adapters/mt5_real.py`), real process discovery (`adapters/process_probe_psutil.py`), and account auto-discovery (`discovery.py`) into `supervisor.py` — one supervised child process per trading account. Entrypoint: `python -m bridge` (no args; accounts are discovered from running portable MT5 terminals, `bridge/accounts/*.json` is an optional override, never a prerequisite). Deployed as the `bridge` nssm service on forexvps.

Multiple portable terminals may use the same login. The supervisor leaves every terminal running, selects one deterministic bridge owner per login, preserves the generated owner across supervisor restarts while it remains discoverable, and fails over after bounded worker backoff when the owner disconnects. Duplicate/discovery warnings are emitted once per state change; worker-exit logs include login, profile path, terminal path, PID when known, and reason. If a failover changes the terminal profile, the existing journal profile remains the durable producer identity so live sequences and history checkpoints continue without rekeying or wiping state.

Discovery attaches only to enumerated running processes, but the MetaTrader5 package reserves the right to launch a terminal when `initialize()` cannot attach — so every discovery `initialize()` is followed by a spawn guard (`spawn_guard.py`): a duplicate that appeared while the probed terminal still runs is killed (it would carry this process's elevation); a liveupdate/crash-restart replacement or a plain exit is skipped and re-discovered on the next rescan, never killed.

## Requirements

- Python 3.11+
- See `bridge/requirements.txt` for pinned production deps (pydantic, psutil, redis, and Windows-only MetaTrader5) and `bridge/requirements-dev.txt` for dev/test additions (pytest, hypothesis).

## Install

From the repo root:

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r bridge/requirements.txt        # production runtime deps
pip install -r bridge/requirements-dev.txt    # + pytest/hypothesis for dev/test
```

`bridge/requirements.txt` is the source of truth for version constraints — don't hand-install packages ad hoc. `MetaTrader5` in that file is Windows-only (platform marker), so it's skipped automatically on macOS/Linux dev machines.

No `pip install -e .` yet — there's no `pyproject.toml`/`setup.py` in this package. Run everything from the repo root so `bridge` resolves as a top-level import.

Copy `bridge/.env.example` to `bridge\.env` on the host and fill in real values (`REDIS_URL` at minimum) — see that file for every variable the service reads and their defaults. Never commit `bridge\.env`.

## Run tests

```bash
python3 -m pytest -q bridge/tests
```

`tests/integration/*` and `tests/fault/*` use in-process fakes (no live Redis/MT5 required). `tests/unit/test_canonical.py` needs `hypothesis` installed or it fails to collect. The `psutil`/`redis`/`MetaTrader5` runtime deps above are lazy-imported by the modules that need them, so the test suite passing does not prove they're installed — install them before running the service for real.

## Run the service

```bash
python -m bridge
```

Reads `REDIS_URL` from the environment (required) plus the tuning vars documented in `bridge/.env.example`. Writes per-account health JSON to `<BRIDGE_STATE_DIR>/health/<profile_id>.json` and `<BRIDGE_STATE_DIR>/health/supervisor.json` (`bridge/health.py`). On forexvps this runs under nssm as the `bridge` service — the exact nssm parameter set is applied by `bridge/scripts/install-service.ps1` (procedure recorded in `docs/superpowers/plans/2026-08-17-windows-single-host-migration.md`, Task 6).

History starts no earlier than `BRIDGE_HISTORY_LOWER_BOUND_RAW` (default `1735689600`, representing `2025-01-01 00:00:00` in MT5 broker raw time). The bridge passes this integer to MT5 without timezone or broker-offset conversion. At startup, an older empty-history SQLite checkpoint is raised to this bound only after a verified side-by-side journal backup and transactional safety checks; ambiguous or non-empty state fails closed before Redis or MT5 startup.

Backfill windows coalesce over empty regions (ADR-0006): while the committed prior window is provably empty, the next window widens to `BRIDGE_HISTORY_EMPTY_WINDOW_RAW` (default `2592000`, 30 days) instead of `BRIDGE_HISTORY_WINDOW_RAW`, collapsing back to the normal span once a window is non-empty. Coverage proof rests on contiguous `[start, end)` windows, never on window granularity.

The fenced live snapshot key `mt5:account:{login}:live` is refreshed with a 60-second TTL on every successful complete snapshot. `live.error` does not replace the last complete snapshot, so a stopped or failing publisher naturally leaves no apparently-live key after the TTL.
