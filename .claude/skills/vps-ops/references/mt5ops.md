# mt5ops — MT5 terminal + service stack control (`mt5ops.py`)

Single helper script for MT5 terminals and the analytic service stack:
`scripts/mt5ops.py` (relative to this skill folder). Stdlib-only Python;
run all commands through the shell with `python`.

Merged in from the former standalone `mt5-ops` hermes skill on 2026-08-25 —
this reference + the script are now the single source for MT5 ops.

## When to use

- "check MT5 status" / "is the bridge running" / "bridge health" → `status`
- restart/stop/start any service (bridge, web, worker, caddy, redis, postgres) → `svc`
- temporarily close or reopen an MT5 terminal → `term close` / `term start`
- kill terminals not running portable / stray liveupdate leftovers → `term rogue [--kill]`
- permanently pause/resume an account's auto-launch on reboot → `pause` / `resume`
- "did everything come back after the reboot/Windows update?" → `reboot-check`
- "text me a status update" → `status --notify` or `notify`
- "restart the computer" → `restart-computer` (may be blocked; hand the user the command)

Confirm-first rules from SKILL.md apply: terminal close/start, pause/resume,
service restarts, reboot.

## Quick reference

```
python <skilldir>/scripts/mt5ops.py status
python <skilldir>/scripts/mt5ops.py status --notify
python <skilldir>/scripts/mt5ops.py reboot-check --wait 300
python <skilldir>/scripts/mt5ops.py svc status|start|stop|restart bridge
python <skilldir>/scripts/mt5ops.py stack stop|start [--all]
python <skilldir>/scripts/mt5ops.py term list|close|start
python <skilldir>/scripts/mt5ops.py term rogue [--kill]
python <skilldir>/scripts/mt5ops.py pause MT3|7948784 [--dry-run]
python <skilldir>/scripts/mt5ops.py resume MT3|7948784 [--dry-run]
python <skilldir>/scripts/mt5ops.py notify "text" [--to +66...]
python <skilldir>/scripts/mt5ops.py restart-computer
```

`<skilldir>` = the directory this SKILL.md lives in. On this host the Hermes
agent loads `%LOCALAPPDATA%\hermes\skills\automation\vps-ops` — prefer that
copy when running as Hermes. The repo copy (`C:\analytic\.claude\skills\vps-ops`)
is the source of truth; `C:\Users\supachai\.agents\skills\vps-ops` serves
other agent tooling. Resolve from the skill's own location when unsure.

## Facts that drive the design

- Terminals are NOT spawned by the bridge. `python -m bridge` only attaches to
  running portable terminals; killing a terminal leaves it dead until manually
  restarted or reboot.
- **`term start` launches ONLY a `.lnk`** (Startup `.lnk` first, else the one
  parked in `C:\pause` — starting a paused terminal manually is fine and does
  NOT resume its autostart). Direct `terminal64.exe /portable` launches are
  forbidden by this skill (portable-profile wiring) — the script refuses and
  errors out if no `.lnk` exists for the folder.
- Auto-launch on boot = Startup-folder `.lnk` per terminal. **pause = move
  `.lnk` to `C:\pause`; resume = move it back.** Do NOT rename in place.
- Expected terminals derive from `C:\analytic\bridge\state\discovered-accounts\*.json`
  (`executable_path`, `expected_login`) — no hardcoded account list. (The old
  `bridge\accounts\` dir died with the 2026-08-30 schtasks migration; status
  fails loud when it finds no accounts there.)
- Service rows in `status`: `bridge` = `analytic-bridge` scheduled-task state
  (schtasks, not NSSM), `redis-wsl` = TCP probe of 6379 (Redis lives in WSL
  behind the keepalive task — there is no Windows service to query).
- Bridge live-freshness = Redis key `mt5:account:{login}:live` TTL (60 s
  window, braces around the login are part of the key). Health JSON in
  `bridge/state/health/` shows per-account restart/quarantine state.
- After `svc restart bridge`, live keys take **~5-6 min** to republish (task
  cold start + per-worker attach backoff; matches host-facts). A DEGRADED
  status in that window is expected — re-check after ~6 min before treating
  it as a fault.
- `terminal64.exe` under `AppData\Roaming\MetaQuotes\...\liveupdate\` is a
  liveupdate process, not the install-dir terminal — `term list` and the
  status terminals block never count it. Two kinds: `/update` children
  (transient file copiers — leave them alone unless stale, >10 min) and
  `/skipupdate` staging duplicates (a real terminal running off the staged
  binary while the install-dir terminal also runs — stuck after the
  ~3-min handoff grace window; the 2026-09-06 incident left two running
  8+ min). `term rogue` classifies all of this; `--kill` force-kills.
- Service stop order: caddy first, then analytic-web, analytic-worker, bridge.
  Start order is reverse (bridge, worker, web, caddy). `stack` encodes this.
- nssm prints UTF-16LE on Windows — the script strips embedded NULs.

## Procedure

1. Status: run `status`. Three blocks (services / terminals / live). Exit 0 =
   OK, 1 = degraded. Criterion: every expected terminal running AND every
   account live key fresh AND all services SERVICE_RUNNING.
2. Service control: `svc <action> <name>` — waits up to 60 s for the target
   state. Dispatch: bridge → schtasks `/End`/`/Run`; redis-wsl → status-only
   (refuses actions); everything else nssm. Criterion: reported state matches
   requested state.
3. Close terminal: `term close MT3` — graceful `taskkill /PID` (WM_CLOSE so
   MT5 saves state), waits 20 s, only `--force` escalates to `/F`. Warns when
   the account has open positions. Criterion: process gone from `term list`.
4. Start terminal: `term start MT3` — `Start-Process` on the `.lnk`. Live key
   should repopulate within ~60 s; verify with `status`.
4b. Rogue terminals: `term rogue` lists every `terminal64.exe` classified as
   `ok / nonportable / staging-duplicate / updater / unknown` with PIDs and
   ages. Default is list-only — killing requires the operator's go-ahead,
   then `term rogue --kill` (force-kill by PID only). Criterion: exit 0 and
   "no rogue terminal processes".
5. Pause/resume: `pause <folder|login>` moves the Startup `.lnk` to
   `C:\pause`; `resume` moves it back. Criterion: move confirmed (or
   `--dry-run` shows the exact move). Terminal keeps running now; it just
   won't come back on next reboot.
6. Post-reboot: `reboot-check --wait 300` polls until all services RUNNING +
   all expected terminals up + all live keys fresh, or timeout. Criterion:
   final line `REBOOT-CHECK: PASS`.
7. Text the user: `status --notify` (auto-summary) or `notify "<text>"` —
   sends via the Photon SMS sidecar (`http://127.0.0.1:<port>/send`, token
   from `%LOCALAPPDATA%\hermes\runtime\photon-sidecar.json`; default target
   from `PHOTON_ALLOWED_USERS` in the hermes `.env`). If Photon returns
   `target_not_allowed`, say so — don't claim delivery.
8. `restart-computer` runs `shutdown /r /t 30`. If access is denied (agent
   runs non-elevated), hand the user the exact command instead of retrying.

## Pitfalls

- Never use `sc.exe` for service control on this host — nssm only (the script
  already does). `nssm dump` also hangs — NSSM config via registry
  `HKLM\SYSTEM\CurrentControlSet\Services\<name>\Parameters` if ever needed.
- Rogue/staging terminal processes ignore WM_CLOSE (no reachable window) —
  `term rogue --kill` goes straight to `taskkill /F`, always by PID. Never
  `taskkill /IM terminal64.exe`.
- `svc` refuses `redis-wsl` start/stop on purpose: Redis lives in WSL and its
  lifecycle belongs to the `analytic-redis-wsl-keepalive` task — don't
  improvise WSL shutdowns.
- Never echo the Redis password; the script passes it via `REDISCLI_AUTH` env
  to redis-cli inside WSL.
- Closing a terminal stops its EAs; open positions stay server-side.
- `svc stop/restart bridge` drives the scheduled task (`schtasks /End` + `/Run`
  analytic-bridge); `/End` takes the wrapper process tree and all per-account
  workers down, and live keys take **~5-6 min** to republish after a restart.
  `redis-wsl` is status-only in `svc` (TCP probe) — its lifecycle belongs to
  the WSL keepalive task, so `stack` refuses it and `--all` adds only
  `postgresql-x64-18` (via Stop/Start-Service — the native-service exception).
- `pause` refuses if the `.lnk` is not in Startup; `resume` refuses if nothing
  parked in `C:\pause`. Both check destination-collision before moving.
- Machine restart is typically blocked for the agent — expect
  `restart-computer` to fail with access denied; that's expected, not a bug.

## Verification

- `status` exits 0 and prints all three blocks with real values (no "unknown").
- `term list` shows every expected folder from
  `bridge\state\discovered-accounts\*.json` as running, with autostart
  on/paused/none per folder.
- `pause MT5 --dry-run` then `resume MT5 --dry-run` print the exact moves and
  change nothing; a real `pause` → `resume` round-trip leaves the Startup
  folder unchanged.
- `notify "test" --dry-run` resolves sidecar port+token and target number
  without sending.
