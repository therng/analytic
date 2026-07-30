# bridge `__main__.py` entrypoint — design

Status: approved, not yet implemented (2026-07-30).

## Problem

`bridge/` (renamed from `mt5_bridge_native`, replacement for the deleted
`bridge_v2`) has fencing-lease Redis transport, a durable SQLite journal, and
live/history sync logic — but zero concrete implementations wired to a real
MT5 terminal. `Mt5Port`, `ProcessProbe`, and account config loading don't
exist. There is no CLI entrypoint at all; `python -m bridge` fails with
`ModuleNotFoundError`. The `bridge` nssm service on forexvps is installed
and paused (crash-looping) for exactly this reason.

## Scope

Full build: real MT5 adapter, real process discovery, per-account config
loading, and the supervisor/worker entrypoint — one native bridge process
per trading account, matching the deleted `bridge_v2`'s process model (the
existing `nssm bridge` service and ops tooling already assume "one service,
one child per account").

## Architecture

`bridge/__main__.py` is a supervisor. It scans `bridge/accounts/*.json`
(one file per account), spawns one child process per file
(`python -m bridge.worker <config-path>`, `CREATE_NEW_PROCESS_GROUP` on
Windows so `CTRL_BREAK_EVENT` can target a single child), tracks children,
restarts a crashed child after backoff, and forwards `SIGINT`/`SIGTERM`/
`CTRL_BREAK` to all children on shutdown. This mirrors `bridge_v2/run_all_v2.py`'s
supervisor loop (`subprocess.Popen` per account, signal-driven child stop).

## Components

- **`bridge/adapters/mt5_real.py` — `RealMt5Port`.** Thin wrapper over the
  real `MetaTrader5` module: `initialize`, `shutdown`, `version`,
  `terminal_info`, `account_info`, `positions_get`, `orders_get`,
  `history_deals_get`, `history_orders_get`, `last_error` — one line each,
  direct passthrough. No None/exception/tuple classification here:
  `StrictMt5Adapter` (`bridge/mt5_adapter.py`, already built and tested)
  does that on top. This is simpler than `bridge_v2/mt5_client.py`, which
  duplicated classification that the new architecture already owns
  elsewhere.

- **`bridge/adapters/process_probe_psutil.py` — `RealProcessProbe`.**
  Enumerates `terminal64.exe` processes via `psutil`
  (`process_iter(attrs=["exe", "name", "cmdline", "create_time", ...])`),
  builds a `ProcessCandidate` per match, and calls the existing
  `process_probe.select_process()` (already built and tested) to resolve
  and verify against one `TerminalProfile`. Ports the matching logic from
  `bridge_v2/terminal_discovery.py`'s `terminal_process_is_running`, adapted
  to the richer `ProcessCandidate`/`ProcessFingerprint` contract (which also
  needs `session_id` and `data_path` — bridge_v2 never needed those, so this
  part is new, not ported).

- **`bridge/account_config.py`.** Loads one `bridge/accounts/<login>.json`
  into a `TerminalProfile` (`bridge/config.py`) plus a journal path. JSON
  schema: the exact fields `TerminalProfile` already requires
  (`executable_path`, `portable`, `expected_data_path`, `expected_login`,
  `expected_server`, `initialize_timeout_ms`, `coordination_domain`,
  `history_lower_bound_raw`) plus `journal_path`. Pydantic validation
  already exists on `TerminalProfile` itself — the loader only needs to
  read JSON and construct it, no new validation logic.

- **`bridge/worker.py`.** Per-account loop, run as
  `python -m bridge.worker <config-path>`:
  1. Load config, open SQLite journal (`journal/connection.py` +
     `journal/migrations.py`, already built).
  2. Acquire local ownership lock (`ownership.py`, already built) — refuses
     to start a second worker against the same login on this host.
  3. Acquire Redis fencing lease (`redis_transport.py` `RedisLease`,
     already built).
  4. Connect via `TerminalSession.connect_verified` (`terminal_session.py`,
     already built) using `RealMt5Port` + `RealProcessProbe`.
  5. Loop: call `LivePublisher.poll_once` and
     `HistorySynchronizer.run_next_window` on a cadence, overridable via
     env vars following the existing `WORKER_V2_EQUITY_SAMPLE_MS` convention
     (the implementation plan picks the concrete default interval and var
     names); renew the lease before its TTL; `revalidate()` per the session
     contract already built into both publishers.
  6. On `CTRL_BREAK_EVENT`: release the lease, close the journal, exit 0.

## Error handling

- Fenced writes already fail closed by construction (`LeaseUnavailable`
  from `redis_transport.py` on any fence mismatch) — the worker loop
  treats that as "stop, let the supervisor decide whether to restart."
- A crashed worker child gets restarted by the supervisor after a backoff,
  not by nssm restarting the whole `bridge` service — restarting the whole
  service would bounce every account for one account's failure.
- MT5/process-identity violations (`TerminalIdentityViolation`) are
  fail-closed by the already-built `TerminalSession` — the worker treats
  them the same as a lease loss: stop, let the supervisor retry.

## Testing

`MetaTrader5` and real `psutil` process matching are Windows-only and need
a live MT5 terminal — cannot run or unit-test `RealMt5Port` or
`RealProcessProbe` from a non-Windows dev machine. Scope split:

- Unit-testable here: `account_config.py` (JSON parsing → `TerminalProfile`),
  the supervisor's spawn/restart/signal-forwarding logic (with a fake
  `subprocess.Popen`), `worker.py`'s loop structure (with the existing
  in-memory fakes the test suite already uses for `LiveSession`/
  `HistorySession`).
- Only verifiable on forexvps: `RealMt5Port` against a real terminal,
  `RealProcessProbe` against real Windows processes, the full worker loop
  end-to-end.

## Out of scope (this design)

- Config hot-reload (adding an account JSON while the supervisor is
  running) — restart the supervisor for now.
- Startup-shortcut auto-discovery (what `bridge_v2/terminal_discovery.py`
  did) — superseded by explicit `executable_path` in each account's JSON,
  which `TerminalProfile` already requires. Simpler than bridge_v2, no
  discovery step needed for the path itself (still needed for *verifying*
  a terminal is running, which is `RealProcessProbe`'s job).
