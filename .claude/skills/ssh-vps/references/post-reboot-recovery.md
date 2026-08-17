WHEN: "check terminals after reboot", after a Windows Update restart, or "everything looks down since last night".

**SSH command patterns:** See command-execution-strategy.md (Tier 1 unless noted).

DO (in order):
1. SSH sanity: `ssh forexvps 'whoami'` — timeout = host may still be applying updates; retry ONCE after 2 min, then report. Host-key-changed = STOP, confirm with user. 
2. Boot actually completed, no pending second reboot:
   `ssh forexvps 'powershell -NoProfile -Command "Get-CimInstance Win32_OperatingSystem | Select-Object LastBootUpTime"'`
   Pending second reboot = `(Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') -or ((Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' -Name PendingFileRenameOperations -ErrorAction SilentlyContinue) -ne $null)` → true = tell the user a second reboot is queued; services may be unstable until then.
3. Stack services (auto-start via SCM + DependOnService — data tier first):
   `ssh forexvps 'powershell -NoProfile -Command "Get-Service postgresql-x64-16,redis-wsl,analytic-worker,analytic-web,caddy | Format-Table Name,Status"'`
   Expect all Running within ~2 min of boot (worker may cycle a few times while Redis/Postgres warm up — that's normal). Stuck STOPPED/START_PENDING > 2 min → analytic-services.md for per-service checks; `no such service` = stack not installed yet (migration in progress), skip.
4. Terminals (interactive session required — Startup .lnk only fire on logon): `Get-Process terminal64` (0 running → check a session exists: `qwinsta`; a `console` session in State `Active` = fine, `Disc` = disconnected-but-alive (processes keep running); NO console/RDP session at all = terminals wait for login — tell the user, don't "fix" by launching terminal64.exe directly).
5. Bridge: `ssh forexvps 'nssm status bridge'` → SERVICE_RUNNING expected (SERVICE_AUTO_START, independent of logon).
6. Per-account health JSONs (most authoritative): see status-check.md step 5 — every account's `last_successful_live_poll_utc` should advance within ~2-3 min of the bridge coming up. Stale while process runs = stuck → targeted `nssm restart bridge` (with user confirmation per global safety).
7. End-to-end: worker health `:9200/health` → 200 and web `/api/accounts` → 200 — both bind 127.0.0.1, so run them ON HOST via SSH (not from your machine); only the `curl -sI https://therng.duckdns.org/` check runs from your machine (quick-check commands: analytic-services.md).

GRACE PERIODS: MT5 terminals need a few minutes to init after launch; the bridge needs time to discover + first live poll. Don't declare anything stuck inside the first 5 minutes post-boot.

REPORT (plain language): "forexvps back up: 6 services running, Boat/Eak/Airisa2 up, Jade paused, bridge healthy, dashboard 200, live polls fresh." — then remediate only what's down, each restart requiring explicit user confirmation.

iMessage summary if the user asked for one: imessage-summary.md.
