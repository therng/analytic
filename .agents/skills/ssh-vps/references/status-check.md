WHEN: "check MT5 status", "is bridge up", "เช็ค MT5".

DO:
1. `ssh forexvps 'powershell -NoProfile -Command "Get-Process terminal64 | Select-Object Id, ProcessName, Path"'`
   No process → error "Cannot find a process with the name terminal64" = 0 running, not a failure.
2. `ssh forexvps 'powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; Get-ChildItem \"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\" -Filter *.lnk | ForEach-Object { $sc = $ws.CreateShortcut($_.FullName); [PSCustomObject]@{ Name=$_.BaseName; TargetPath=$sc.TargetPath; Arguments=$sc.Arguments } }"'`
   Match `TargetPath`/`Path` against step 1 → named terminal (e.g. "Boat") up/down.
3. `ssh forexvps 'nssm status bridge'` (fallback: `sc query bridge`) — service is installed; expect `SERVICE_RUNNING`. `SERVICE_PAUSED`/crash-loop → see service-repair.md. "no such service" → not installed, see service-install.md FRESH INSTALL.
4. `ssh forexvps 'powershell -NoProfile -Command "if (Test-Path C:\Pause) { dir C:\Pause } else { Write-Output \"C:\Pause does not exist yet\" }"'`
5. OPTIONAL per-account health (most authoritative liveness) — bridge writes a versioned JSON file per account under `<state_dir>/health/<profile_id>.json` plus `<state_dir>/health/supervisor.json` (bridge/health.py); confirm the live `state_dir` first (`ssh forexvps 'nssm get bridge AppParameters'` / check `BRIDGE_STATE_DIR` env on the service — don't assume a path), then:
   ```
   ssh forexvps 'powershell -NoProfile -Command "Get-ChildItem C:\analytic\bridge\state\health\*.json | Get-Content"'
   ```
   Key fields: `state`, `last_transition_at_utc`, `last_successful_live_poll_utc`, `restart_count`, `quarantine`. Stale `last_successful_live_poll_utc` + process running = stuck (targeted restart worth it). No file for an account that should be running = never started or state dir mismatch.
   NOTE: the Redis key `mt5:v2:bridge:*:heartbeat` belongs to the retired `bridge_v2`/worker-v2 heartbeat mechanism — not read by this bridge. Don't use it as a liveness signal here.

OUTPUT: name each terminal up/down/paused, not a bare count. e.g. "forexvps: Boat, Eak up. Airisa2 down. Jade paused."

FAIL: account in `C:\Pause` (step 4) = "paused", never "down/missing".
