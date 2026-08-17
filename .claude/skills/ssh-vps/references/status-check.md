WHEN: "check MT5 status", "is bridge up", "เช็ค MT5", "เว็บลง/เว็บไม่ขึ้น", stack/worker/web/postgres/redis health.

**SSH command patterns:** See command-execution-strategy.md (Tier 1 for all commands — single-quoted SSH + PowerShell).

## A. Terminals + bridge (original checks)

DO:
1. `ssh forexvps 'powershell -NoProfile -Command "Get-Process terminal64 | Select-Object Id, ProcessName, Path"'`
   No process → error "Cannot find a process with the name terminal64" = 0 running, not a failure.
2. List startup shortcuts (Tier 2 — complex COM object):
   ```bash
   ps_script='$ws = New-Object -ComObject WScript.Shell; Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup" -Filter *.lnk | ForEach-Object { $sc = $ws.CreateShortcut($_.FullName); [PSCustomObject]@{ Name=$_.BaseName; TargetPath=$sc.TargetPath; Arguments=$sc.Arguments } }'
   encoded=$(printf '%s' "$ps_script" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')
   ssh forexvps "powershell -NoProfile -EncodedCommand '$encoded'"
   ```
   Match `TargetPath`/`Path` against step 1 → named terminal (e.g. "Boat") up/down.
3. `ssh forexvps 'nssm status bridge'` (fallback: `sc query bridge`) — expect `SERVICE_RUNNING`. `SERVICE_PAUSED`/crash-loop → see service-repair.md. "no such service" → not installed, see service-install.md FRESH INSTALL.
4. Check Pause directory (Tier 1 — simple conditional):
   ```bash
   ssh forexvps 'powershell -NoProfile -Command "if (Test-Path C:\Pause) { dir C:\Pause } else { Write-Output '\''C:\Pause does not exist yet'\'' }"'
   ```
   (Note: `'\''` is bash single-quote escaping: end quote, literal quote, start quote again)
5. OPTIONAL per-account health (most authoritative liveness) — bridge writes a versioned JSON per account under `<state_dir>/health/<profile_id>.json` plus `supervisor.json` (bridge/health.py). Confirm the live `state_dir` from `nssm get bridge AppEnvironmentExtra` — AppParameters only holds `-m bridge`; the BRIDGE_STATE_DIR vars live in AppEnvironmentExtra, and that block ALSO holds REDIS_URL, so filter (`| Select-String BRIDGE_STATE_DIR`), never dump it. Standard install path = `C:\analytic\bridge\state`:
   ```
   ssh forexvps 'powershell -NoProfile -Command "Get-ChildItem C:\analytic\bridge\state\health\*.json | Get-Content"'
   ```
   Key fields: `state`, `last_transition_at_utc`, `last_successful_live_poll_utc`, `restart_count`, `quarantine`.
   STALENESS RULE: live poll cadence is ~1s and the Redis live key TTL is 60s — `last_successful_live_poll_utc` older than ~2-3 min while the process runs = stuck (targeted restart worth it). Before calling a quiet feed stale, check market hours (weekend/after-hours = legitimately no ticks).
   No file for an account that should be running = never started or state dir mismatch.
   NOTE: the Redis key `mt5:v2:bridge:*:heartbeat` belongs to the retired `bridge_v2` mechanism — not read by this bridge. Don't use it as a liveness signal.
6. Logs (when step 5 shows stuck/quarantine/crash-loop) — nssm stdout/stderr, 10MB rotation, supervisor + all children share the pair:
   `ssh forexvps 'powershell -NoProfile -Command "Get-Content C:\analytic\bridge\logs\bridge-stdout.log -Tail 50"'` (and `bridge-stderr.log`).
   Look for: discovery warnings, MT5 init failures, Redis connection errors, backoff/quarantine reasons.

## B. Analytic stack services (postgres/redis/worker/web/caddy)

Full inventory + all commands: references/analytic-services.md. Minimum viable check:

7. `ssh forexvps 'powershell -NoProfile -Command "Get-Service postgresql-x64-16,redis-wsl,analytic-worker,analytic-web,caddy | Format-Table Name,Status"'`
   ("no such service" = stack not installed yet — migration in progress; skip B, report that.)
8. Worker health (component-aware — the real pipeline probe):
   `ssh forexvps 'powershell -NoProfile -Command "(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9200/health).StatusCode"'` → 200; 503 = body names the stale component.
9. Web + edge: `(Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/accounts).StatusCode` → 200 (`/api/health` is static `{ok:true}`, proves nothing). From your machine: `curl -sI https://therng.duckdns.org/`.

ORDER FOR "STALE DASHBOARD": run B first (worker 503/stale component is the usual culprit and names the broken stage), then A (bridge/terminals feed the pipeline). Redis alive: `ssh forexvps 'wsl -d Ubuntu --exec redis-cli ping'` → PONG or NOAUTH (both = alive).

OUTPUT: name each terminal up/down/paused, not a bare count. e.g. "forexvps: Boat, Eak up. Airisa2 down. Jade paused. Stack: 5 services running, worker health 200, dashboard 200."

FAIL: account in `C:\Pause` (step 4) = "paused", never "down/missing".
