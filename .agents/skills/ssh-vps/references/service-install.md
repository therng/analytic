WHEN: "install bridge service", "install nssm service", service missing/crash-looping on forexvps.

STATUS: entrypoint exists — `python -m bridge` (bridge/__main__.py), takes no args, auto-discovers accounts via bridge/discovery.py. A `bridge` nssm service is already installed on forexvps; it was paused/crash-looping before this entrypoint shipped because `AppParameters` pointed at nothing runnable. Check status first (`ssh forexvps 'nssm status bridge'`) — most requests here are REPAIR (fix stale AppParameters, resume), not a from-scratch install.

SERVICE NAME: `bridge` (matches the package — old `MT5BridgeV2`/`bridge_v2` names are retired).

## Preflight — auto-discovery and permissions

Verify these BEFORE installing/repairing the service, not after — a service that installs cleanly but can't see any terminals fails silently (empty account set, no error):

1. **Portable mode required.** Discovery only matches `terminal64.exe` processes launched with `/portable` or `-portable` in their command line (`bridge/process_probe.py::_portable_mode`) — matches terminal-control.md's existing rule that terminals are only ever launched via their Startup `.lnk` (never `terminal64.exe` direct). A non-portable terminal is silently skipped with a warning, not an error — check discovery warnings (worker/supervisor stdout log) if an expected account never shows up.
2. **Dedup is already handled, no config needed.** `discover_accounts()` dedupes by both `executable_path` (one candidate per running exe) and by resolved MT5 `login` — two terminals logged into the same account collapse to one worker automatically (`bridge/discovery.py`). Nothing to configure here; verify it, don't reimplement it.
3. **Cross-session visibility.** MT5 terminals are launched interactively (Startup folder, in a logged-on user's session). The service enumerates `terminal64.exe` via `psutil.process_iter` and resolves each PID's session ID via a raw `ProcessIdToSessionId` call (`bridge/adapters/process_probe_psutil.py`) — reading `exe`/`cmdline`/`username` for a process owned by a *different* Windows session requires elevated query rights. Run the service as `ObjectName: LocalSystem` (default below) — it has cross-session visibility by default. If you ever change `ObjectName` to a specific user, that user must run in (or have explicit rights into) the same session as the MT5 terminals, or discovery silently degrades: candidates come back with `evidence_complete=False` and get skipped with a warning, not an error — no crash, just missing accounts.
4. **Filesystem permissions.** The service account needs read/write on `C:\analytic\bridge\state\**` (health, quarantine, locks, journal), read on `C:\analytic\bridge\accounts\**` (optional overrides) and `C:\analytic`, and write on the log directory below. LocalSystem already has this; a restricted service account needs it granted explicitly.
5. **First run on a fresh state dir.** `<state_dir>/health` and `<state_dir>/quarantine` self-create on first write (`atomic_io.py`'s `mkdir(parents=True, exist_ok=True)`); `<state_dir>/locks` now does too as of this deploy (`bridge/ownership.py::LocalLoginLock.acquire`) — no manual `mkdir` needed before first start.

## Path configuration — no ambiguity

`BRIDGE_STATE_DIR` (Python-resolved, used directly by the supervisor process) and `BRIDGE_STATE_DIR_WINDOWS` (a literal string baked into each generated per-account config for the child worker) **must point at the same physical directory** — leaving one at its relative default while overriding only the other silently splits health/quarantine state from where the child actually looks. Set both explicitly to the same absolute path in `AppEnvironmentExtra` below; don't rely on relative-path defaults resolving the same way by coincidence of `AppDirectory`.

## Expected config

```
Application           : C:\Python314\python.exe
AppDirectory           : C:\analytic
AppParameters          : -m bridge
AppEnvironmentExtra    : REDIS_URL=<from bridge\.env on the host — never hardcode in this doc or echo it in chat>
                          BRIDGE_STATE_DIR=C:\analytic\bridge\state
                          BRIDGE_STATE_DIR_WINDOWS=C:\analytic\bridge\state
DisplayName            : bridge
Start                  : SERVICE_AUTO_START
ObjectName              : LocalSystem
AppStdout              : C:\analytic\bridge\logs\bridge-stdout.log
AppStderr              : C:\analytic\bridge\logs\bridge-stderr.log
AppRotateFiles          : 1
AppRotateOnline         : 1
AppRotateBytes          : 10485760
AppExit Default         : Restart
AppRestartDelay         : 5000
AppStopMethodConsole    : 25000
```

Full var list (tuning, not just the two above) lives in `bridge/.env.example` — set anything non-default the same way, via `AppEnvironmentExtra`.

**Stdout/stderr:** child workers (`python -m bridge.worker`) are spawned by the supervisor via plain `subprocess.Popen` with no `stdout=`/`env=` override (`bridge/supervisor.py::default_spawn`), so they inherit the supervisor's own stdio and env — one pair of log files covers the supervisor and every account's worker. Create `C:\analytic\bridge\logs` before starting if it doesn't exist; nssm does not create the log directory itself.

**Restart behavior:** `AppExit Default Restart` (nssm's default, pinned explicitly) restarts the top-level `python -m bridge` process if it exits — this only matters for a genuine supervisor crash; per-account failures never reach this layer, they're retried/backed-off/quarantined internally by `bridge/restart_policy.py` without the nssm-visible process exiting. `AppRestartDelay 5000` floors the restart gap so a crash-loop doesn't hot-spin (nssm's own throttle detection adds further backoff on repeated fast failures).

**Graceful stop:** `python -m bridge` handles `SIGTERM`/`SIGINT` (nssm's Ctrl+C console-control-event stage) by calling `supervisor.request_stop()`, which runs a bounded shutdown ladder per child — CTRL_BREAK wait, then terminate-grace, then kill-grace (`BRIDGE_CTRL_BREAK_WAIT_MS` / `BRIDGE_SHUTDOWN_GRACE_MS` / `BRIDGE_SHUTDOWN_KILL_GRACE_MS`, defaults sum to 22s). `AppStopMethodConsole 25000` gives that cascade room to finish before nssm's console-stop stage times out and escalates toward `TerminateProcess`. **If you change any `BRIDGE_*_GRACE_MS`/`BRIDGE_*_WAIT_MS` var, raise `AppStopMethodConsole` to stay above their new sum** — a mismatch here means Windows hard-kills mid-shutdown instead of letting MT5 terminals release cleanly.

## REPAIR (service exists but config is stale/wrong — the common case)

1. `ssh forexvps 'nssm get bridge AppParameters'` — compare against `-m bridge` above.
2. If different: `ssh forexvps 'nssm set bridge AppParameters "-m bridge"'`
3. `ssh forexvps 'nssm set bridge AppDirectory C:\analytic'` — confirm, don't assume.
4. Confirm `AppEnvironmentExtra` has `BRIDGE_STATE_DIR` and `BRIDGE_STATE_DIR_WINDOWS` set to the same value (`ssh forexvps 'nssm get bridge AppEnvironmentExtra'`) — fix per the path-configuration note above if not.
5. Confirm log paths / rotation / stop-method values above are set; fill in whichever are missing (`nssm set bridge <Key> <Value>` per key — nssm has no bulk-set).
6. `ssh forexvps 'nssm start bridge'`, then verify per status-check.md (health JSON under state dir, not the old Redis heartbeat key).

## FRESH INSTALL / REPAIR — use the script

`bridge/scripts/install-service.ps1` (in-repo, pulled to the host by deploy.md) does every step below idempotently: creates `bridge\logs` and `bridge\state`, installs the service if missing, sets AppDirectory/Start/logs/rotation/restart-behavior, and sets `AppEnvironmentExtra` (`REDIS_URL` read from `bridge\.env` on the host, `BRIDGE_STATE_DIR`/`BRIDGE_STATE_DIR_WINDOWS`) — never echoes the Redis URL. It does **not** start the service itself.

```
ssh forexvps 'powershell -NoProfile -Command "cd C:\analytic; git pull"'   # make sure the script itself is current
ssh forexvps 'powershell -NoProfile -File C:\analytic\bridge\scripts\install-service.ps1'
```
Read the printed config/status, then (after confirming with the user per SAFETY below):
```
ssh forexvps 'nssm start bridge'
```
Verify per status-check.md.

Safe to re-run any time — same script handles "no such service" (fresh install), a pending-deletion/stale service entry (Windows `nssm remove` leaves the registry key in limbo until the last handle closes; `Get-Service`/`nssm status` report it missing during that window even though `nssm set` still works — just retry `nssm status bridge` a few times, it clears on its own), and routine config drift (REPAIR case above).

Manual fallback (script unavailable / editing by hand): every `nssm set` key it applies is listed in "Expected config" above — apply the same keys directly via `nssm set bridge <Key> <Value>` per the REPAIR steps.

SAFETY: confirm with user before install/config changes and before `nssm start` — not reversible via a simple undo, and a bad value crash-loops silently until someone checks. Never print the Redis URL/password to chat (global safety rule).
