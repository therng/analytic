WHEN: fresh install — `ssh forexvps 'nssm status bridge'` errors "no such service". For an existing service that's crash-looping / paused / has stale config, use service-repair.md instead (the common case).

**SSH command patterns:** See command-execution-strategy.md (Tier 1 for simple, Tier 2 for complex/passwords).

STATUS: entrypoint exists — `python -m bridge` (bridge/__main__.py), takes no args, auto-discovers accounts via bridge/discovery.py.

SERVICE NAME: `bridge` (matches the package — old `MT5BridgeV2`/`bridge_v2` names are retired).

## Preflight — auto-discovery and permissions

Verify these BEFORE installing/repairing the service, not after — a service that installs cleanly but can't see any terminals fails silently (empty account set, no error):

1. **Portable mode required.** Discovery only matches `terminal64.exe` processes launched with `/portable` or `-portable` in their command line (`bridge/process_probe.py::_portable_mode`) — matches terminal-control.md's existing rule that terminals are only ever launched via their Startup `.lnk` (never `terminal64.exe` direct). A non-portable terminal is silently skipped with a warning, not an error — check discovery warnings (worker/supervisor stdout log) if an expected account never shows up.
2. **Dedup is already handled, no config needed.** `discover_accounts()` dedupes by both `executable_path` (one candidate per running exe) and by resolved MT5 `login` — two terminals logged into the same account collapse to one worker automatically (`bridge/discovery.py`). Nothing to configure here; verify it, don't reimplement it.
3. **Service account and cross-session visibility.** The bridge service MUST run as `ObjectName: .\supachai` so it has access to the MT5 terminals and the account-specific filesystem state owned by the interactive `supachai` session. Do not reset `ObjectName` to `LocalSystem` during install or repair. If discovery of terminals in another Windows session is required, the `supachai` account must be running in that same interactive session; otherwise discovery can silently degrade: candidates come back with `evidence_complete=False` and are skipped with a warning rather than crashing.
4. **Filesystem permissions.** The `supachai` service account needs read/write on `C:\analytic\bridge\state\**` (health, quarantine, locks, journal), read on `C:\analytic\bridge\accounts\**` (optional overrides) and `C:\analytic`, and write on the log directory below. Verify these permissions before starting the service.
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
ObjectName              : .\supachai
AppStdout              : C:\analytic\bridge\logs\bridge-stdout.log
AppStderr              : C:\analytic\bridge\logs\bridge-stderr.log
AppRotateFiles          : 1
AppRotateOnline         : 1
AppRotateBytes          : 10485760
AppExit Default         : Restart
AppRestartDelay         : 5000
AppThrottle             : 1500
AppStopMethodConsole    : 25000
```

Full var list (tuning, not just the two above) lives in `bridge/.env.example` — set anything non-default the same way, via `AppEnvironmentExtra`.

**Stdout/stderr:** child workers (`python -m bridge.worker`) are spawned by the supervisor via plain `subprocess.Popen` with no `stdout=`/`env=` override (`bridge/supervisor.py::default_spawn`), so they inherit the supervisor's own stdio and env — one pair of log files covers the supervisor and every account's worker. Create `C:\analytic\bridge\logs` before starting if it doesn't exist; nssm does not create the log directory itself.

**Restart behavior:** `AppExit Default Restart` (nssm's default, pinned explicitly) restarts the top-level `python -m bridge` process if it exits — this only matters for a genuine supervisor crash; per-account failures never reach this layer, they're retried/backed-off/quarantined internally by `bridge/restart_policy.py` without the nssm-visible process exiting. `AppRestartDelay 5000` floors the restart gap so a crash-loop doesn't hot-spin (nssm's own throttle detection adds further backoff on repeated fast failures).

**Graceful stop:** `python -m bridge` handles `SIGTERM`/`SIGINT` (nssm's Ctrl+C console-control-event stage) by calling `supervisor.request_stop()`, which runs a bounded shutdown ladder per child — CTRL_BREAK wait, then terminate-grace, then kill-grace (`BRIDGE_CTRL_BREAK_WAIT_MS` / `BRIDGE_SHUTDOWN_GRACE_MS` / `BRIDGE_SHUTDOWN_KILL_GRACE_MS`, defaults sum to 22s). `AppStopMethodConsole 25000` gives that cascade room to finish before nssm's console-stop stage times out and escalates toward `TerminateProcess`. **If you change any `BRIDGE_*_GRACE_MS`/`BRIDGE_*_WAIT_MS` var, raise `AppStopMethodConsole` to stay above their new sum** — a mismatch here means Windows hard-kills mid-shutdown instead of letting MT5 terminals release cleanly.

## FRESH INSTALL / REPAIR — use the script

`bridge/scripts/install-service.ps1` (in-repo, pulled to the host by deploy.md, targets Windows Server 2022) does every step below idempotently: preflight-checks `nssm` on PATH, `C:\Python314\python.exe`, and `C:\analytic` all exist; creates `bridge\logs` and `bridge\state`; installs the service if missing; sets AppDirectory/AppParameters/ObjectName/Start/logs/rotation/restart-behavior/AppThrottle; and sets `AppEnvironmentExtra` (`REDIS_URL` read from `bridge\.env` on the host, `BRIDGE_STATE_DIR`/`BRIDGE_STATE_DIR_WINDOWS`) — never echoes the Redis URL. It does **not** start the service itself.

**Service account password required every run.** `nssm set bridge ObjectName account password` needs the `.\supachai` password every time to (re)grant "Log on as a service" — the script prompts via `Read-Host -AsSecureString` if not supplied. A plain `ssh forexvps 'powershell ... install-service.ps1'` has no interactive stdin, so the prompt will hang; either run it from an interactive session (RDP/console) or pass the password non-interactively via Base64 encoding:

**Option A — Interactive session (safest for credentials):**
```bash
ssh forexvps 'powershell -NoProfile -File C:\analytic\bridge\scripts\install-service.ps1'
```
Script will prompt for password via `Read-Host -AsSecureString` (no echo). RDP/console session only.

**Option B — Non-interactive via Base64 encoding (macOS zsh):**
```bash
# Build the PowerShell script as a string (password embedded, never echoed)
ps_script='$p = ConvertTo-SecureString -String "<password>" -AsPlainText -Force; & "C:\analytic\bridge\scripts\install-service.ps1" -ServicePassword $p'

# Encode: UTF-8 → UTF-16LE → base64 (no newlines)
encoded=$(printf '%s' "$ps_script" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')

# Execute
ssh forexvps "powershell -NoProfile -EncodedCommand '$encoded'"
```

Before pulling/starting:
```bash
ssh forexvps 'powershell -NoProfile -Command "cd C:\analytic; git pull"'
```
Read the printed config/status, then (after confirming with the user per SAFETY below):
```
ssh forexvps 'nssm start bridge'
```
Verify per status-check.md.

Safe to re-run any time — same script handles "no such service" (fresh install), a pending-deletion/stale service entry (Windows `nssm remove` leaves the registry key in limbo until the last handle closes; `Get-Service`/`nssm status` report it missing during that window even though `nssm set` still works — just retry `nssm status bridge` a few times, it clears on its own), and routine config drift (see service-repair.md for that path directly).

Manual fallback (script unavailable / editing by hand): every `nssm set` key it applies is listed in "Expected config" above — apply the same keys directly via `nssm set bridge <Key> <Value>` per service-repair.md's steps. For `ObjectName` specifically, use `nssm set bridge ObjectName .\supachai <password>` (both args), not the two-arg form — nssm needs the password to grant the logon right on an account that's never held it.

SAFETY: confirm with user before install/config changes and before `nssm start` — not reversible via a simple undo, and a bad value crash-loops silently until someone checks. Never print the Redis URL/password to chat (global safety rule).
