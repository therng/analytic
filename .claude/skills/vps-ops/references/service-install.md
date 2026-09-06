# service-install — first-time NSSM install

Fresh-host bring-up. **Install order is load-bearing:** data tier → build →
web/worker → caddy → **bridge LAST** (the worker's MKSTREAM consumer groups
must exist before the bridge's first XADD) → per-account broker offsets.

Universal gotcha: `nssm install <name>` without full binary+args opens the
NSSM GUI and hangs an agent shell. Always pass program + arguments.

Prerequisites: platform guard passed (see SKILL.md — if not yet run this
session, run it now, before any command); elevated (Administrator)
PowerShell for the NSSM/firewall/ACL steps.

## 1. PostgreSQL 18 (`postgresql-x64-18` — native, NOT NSSM)

EDB installer → `C:\Program Files\PostgreSQL\18`, port 5432, superuser
password from `C:\analytic-secrets.env`, service auto-start, skip Stack
Builder. Then:

```sql
CREATE ROLE supachai LOGIN PASSWORD '...';
CREATE DATABASE trading_db OWNER supachai;
```

Verify: `& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -U supachai -d trading_db -c "SHOW timezone; SELECT 1;"`
→ `Asia/Bangkok`, `1`.

HAZARD: never start `postgresql-x64-16` (same port 5432).

## 2. Redis (WSL2 systemd + keepalive task — NOT a Windows service)

`wsl --install -d Ubuntu --no-launch`; inside Ubuntu
`sudo apt-get install -y redis-server`; configure `/etc/redis/redis.conf`:
`bind 127.0.0.1`, `requirepass <pw>`, `appendonly yes`, `appendfsync everysec`,
`save 900 1` / `save 300 10` / `save 60 10000`, `maxmemory-policy noeviction`;
enable the systemd unit so it starts with the distro:

```bash
sudo systemctl enable --now redis-server
sudo systemctl is-active redis-server   # active
```

Then register the **keepalive task** — load-bearing. The distro terminates
~60 s after its last `wsl.exe` client, which kills the 6379 localhost relay
(this is what took the site down 2026-08-30). The task holds one session
open forever (matches the live task exported 2026-09-06: LogonTrigger,
InteractiveToken, RunLevel Highest, user `analyticvps\supachai`):

```powershell
schtasks /Create /TN analytic-redis-wsl-keepalive /TR "wsl.exe -d Ubuntu --exec sleep infinity" /SC ONLOGON /RU analyticvps\supachai /IT /RL HIGHEST /F
schtasks /Run /TN analytic-redis-wsl-keepalive
```

There is no `redis-wsl` NSSM service anymore (retired 2026-08-30) — never
`nssm` anything for Redis; restart it with
`wsl -d Ubuntu -u root --exec systemctl restart redis-server`. Verify without
ever typing the password literal into a command:

```powershell
$pw = Read-Host 'Redis password'      # typed hidden — never echoed
wsl -d Ubuntu --exec env REDISCLI_AUTH=$pw redis-cli ping   # PONG
(Test-NetConnection 127.0.0.1 -Port 6379).TcpTestSucceeded  # True
```

## 3. Env files, then build

Write `C:\analytic\.env` (`DATABASE_URL`, `REDIS_URL`, `TZ=Asia/Bangkok`, one
var per line) and `C:\analytic\bridge\.env` (see host-facts.md) from
`C:\analytic-secrets.env` FIRST — the build can statically evaluate routes
that throw without `DATABASE_URL`, so env-before-build avoids a confusing
build failure.

Then build (the web/worker services point at build outputs — build before
installing):

```powershell
cd C:\analytic
npm ci
npx prisma generate
npm run build:worker-v2
npm run build:view-worker
npm run build
```

## 4. analytic-web (NSSM)

```powershell
nssm install analytic-web "C:\nvm4w\nodejs\node.exe" "C:\analytic\.next\standalone\server.js"
nssm set analytic-web AppDirectory C:\analytic\.next\standalone
nssm set analytic-web ObjectName analyticvps\supachai <password>
nssm set analytic-web Start SERVICE_AUTO_START
nssm set analytic-web AppStdout C:\analytic\logs\web-stdout.log
nssm set analytic-web AppStderr C:\analytic\logs\web-stderr.log
nssm set analytic-web AppRotateFiles 1
nssm set analytic-web AppRotateOnline 1
nssm set analytic-web AppRotateBytes 10485760
nssm set analytic-web AppExit Default Restart
nssm set analytic-web AppRestartDelay 5000
nssm set analytic-web AppThrottle 1500
nssm set analytic-web AppStopMethodConsole 25000
nssm set analytic-web AppEnvironmentExtra PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production TZ=Asia/Bangkok "DATABASE_URL=postgresql://supachai:<pw>@127.0.0.1:5432/trading_db" "REDIS_URL=redis://:<pw>@127.0.0.1:6379" AUTH_TRUST_HOST=true "AUTH_URL=https://therng.duckdns.org" "AUTH_SECRET=<secret>"
nssm set analytic-web DependOnService postgresql-x64-18
nssm start analytic-web
```

## 5. analytic-worker (NSSM)

```powershell
nssm install analytic-worker "C:\nvm4w\nodejs\node.exe" "C:\analytic\dist\worker-v2.js"
nssm set analytic-worker AppDirectory C:\analytic
nssm set analytic-worker ObjectName analyticvps\supachai <password>
nssm set analytic-worker Start SERVICE_AUTO_START
nssm set analytic-worker AppStdout C:\analytic\logs\worker-stdout.log
nssm set analytic-worker AppStderr C:\analytic\logs\worker-stderr.log
nssm set analytic-worker AppRotateFiles 1
nssm set analytic-worker AppRotateOnline 1
nssm set analytic-worker AppRotateBytes 10485760
nssm set analytic-worker AppExit Default Restart
nssm set analytic-worker AppRestartDelay 5000
nssm set analytic-worker AppThrottle 1500
nssm set analytic-worker AppStopMethodConsole 25000
nssm set analytic-worker AppEnvironmentExtra TZ=Asia/Bangkok WORKER_V2_ENABLE_LIVE_SYNC=true WORKER_V2_HEALTH_PORT=9200 "DATABASE_URL=..." "REDIS_URL=..."
nssm set analytic-worker DependOnService postgresql-x64-18
nssm start analytic-worker
```

Verify `http://127.0.0.1:9200/health` → 200. A few restart cycles while Redis
settles are normal; a persistent loop is not.

## 6. caddy (NSSM)

Download caddy (with the duckdns module) to `C:\caddy\caddy.exe`, then:

```powershell
New-NetFirewallRule -DisplayName 'caddy-http'  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80
New-NetFirewallRule -DisplayName 'caddy-https' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443
nssm install caddy "C:\caddy\caddy.exe" "run --config C:\analytic\Caddyfile.windows"
nssm set caddy AppDirectory C:\caddy
nssm set caddy ObjectName analyticvps\supachai <password>
nssm set caddy Start SERVICE_AUTO_START
nssm set caddy AppStdout C:\caddy\logs\caddy-stdout.log
nssm set caddy AppStderr C:\caddy\logs\caddy-stderr.log
nssm set caddy AppRotateFiles 1
nssm set caddy AppRotateOnline 1
nssm set caddy AppRotateBytes 10485760
nssm set caddy AppExit Default Restart
nssm set caddy AppRestartDelay 5000
nssm set caddy AppEnvironmentExtra "DUCKDNS_TOKEN=<token>"
nssm set caddy DependOnService analytic-web
nssm start caddy
```

DUCKDNS_TOKEN is required for the HTTPS site (DNS-01/ZeroSSL); `:80` works
without it. Only caddy needs inbound firewall openings (80/443) — keep
everything else blocked inbound. Note the worker health server binds
`0.0.0.0` in code, so the firewall is what keeps `:9200` private (verify
with `netstat -ano | findstr :9200`).

## 7. bridge — LAST, as the `analytic-bridge` scheduled task

The bridge runs in the console session as `analyticvps\supachai` (it must own
the interactive terminals; NSSM variant retired 2026-08-30 —
`bridge\scripts\install-service.ps1` is the RETIRED install path, kept only as
the reference for the journal-dir `icacls` DACL repair; never re-run it).

1. Confirm `C:\analytic\bridge\.env` (REDIS_URL + both state-dir vars) and
   `bridge\scripts\run-bridge-task.ps1` exists.
2. Register the task (matches the live task — ONLOGON, Highest, console
   session, hidden console via `-WindowStyle Hidden`, wrapper tee to
   `bridge-task.log`):

```powershell
schtasks /Create /TN analytic-bridge /TR "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\analytic\bridge\scripts\run-bridge-task.ps1" /SC ONLOGON /RU analyticvps\supachai /IT /RL HIGHEST /F
```

   Do NOT swap the action for a wscript/VBS hidden launcher: verified on the
   host 2026-09-07, `schtasks /End` then kills only the wscript head — the
   powershell/cmd/python tree survives as orphans (they escape the Task
   Scheduler job), breaking the deploy runbook's `/End`-kills-the-tree
   invariant. The direct powershell action keeps both properties: hidden
   console (brief conhost flash at logon) and full tree kill on `/End`. An
   existing visible-action task switches action in place via
   `Set-ScheduledTask` (`schtasks /Change /TR` prompts for the run-as
   password, which is not stored on the host).

3. `schtasks /Run /TN analytic-bridge`, then run the status checks in
   `status-summary.md` (expect ~5-6 min before live TTLs republish). Restart
   later with `schtasks /End /TN analytic-bridge && schtasks /Run /TN analytic-bridge`
   or `mt5ops.py svc restart bridge`.

## 8. Per-account broker UTC offsets (required before ingestion is correct)

```powershell
node --import tsx scripts\set-broker-utc-offset.ts 0 --list
node --import tsx scripts\set-broker-utc-offset.ts <accountNo> <offsetMinutes>
```

The list branch needs TWO arguments — the first is an ignored placeholder
(`0 --list`). Bare `--list` exits 1 with the usage message (the form quoted
in CLAUDE.md is wrong; the script is the authority). All known accounts are
offset 180 — verify against the list output first.

## 9. Defender exclusions (prevents disk/CPU churn on hot paths)

`Add-MpPreference -ExclusionPath` for: PostgreSQL data dir,
`C:\analytic\bridge\state`, `C:\analytic\logs`, `C:\caddy`, each WSL distro's
`ext4.vhdx`.

## Final verification

`Get-Service postgresql-x64-18,analytic-worker,analytic-web,caddy` all
Running; `(Get-ScheduledTask analytic-bridge).State` → Running;
`(Get-ScheduledTask analytic-redis-wsl-keepalive).State` → Running; worker
health 200; `/api/accounts` 200; `https://therng.duckdns.org/` 200;
per-account health JSONs advancing.
