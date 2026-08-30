# host-facts — forexvps ground truth

Single source for names, paths, ports, and known-stale doc lines. Aligned with
host state as of the **2026-08-30 service-tier rebuild** (see migration plan
progress log entry 2026-08-30) + repo v8.72. When live state disagrees with
this file, live state wins — report the drift.

## Service inventory

| Service | Kind | Runs | Port | Logs |
|---|---|---|---|---|
| `postgresql-x64-18` | Native Windows service (EDB installer, NOT NSSM) | PostgreSQL 18 | 127.0.0.1:5432 | `C:\Program Files\PostgreSQL\18\data\log` |
| Redis 8.0.5 | systemd unit `redis-server` INSIDE WSL2 Ubuntu (NOT a Windows service) | `/usr/bin/redis-server` via `/etc/redis/redis.conf`, unit enabled | 127.0.0.1:6379 (WSL localhost fwd) | `journalctl -u redis-server` in Ubuntu |
| `analytic-redis-wsl-keepalive` | Scheduled task (ONLOGON, RU supachai, HIGHEST) | `wsl.exe -d Ubuntu --exec sleep infinity` — holds the distro's last session open; without it the distro terminates ~60 s after its last client and the 6379 relay vanishes (root cause of the 2026-08-30 outage) | — | — |
| `analytic-worker` | NSSM (LocalSystem) | `C:\nvm4w\nodejs\node.exe C:\analytic\dist\worker-v2.js` (AppDirectory `C:\analytic`) | health :9200 | `C:\analytic\logs\worker-stdout.log` / `-stderr.log` |
| `analytic-web` | NSSM (LocalSystem) | `C:\nvm4w\nodejs\node.exe C:\analytic\.next\standalone\server.js` (AppDirectory `C:\analytic\.next\standalone`) | 127.0.0.1:3000 | `C:\analytic\logs\web-stdout.log` / `-stderr.log` |
| `caddy` | NSSM (LocalSystem) | `C:\caddy\caddy.exe run --config C:\analytic\Caddyfile.windows` | 0.0.0.0:80/443 — sole public exposure; `https://therng.duckdns.org` → `127.0.0.1:3000` | `C:\caddy\logs\` (+ `access.log`); ACME/cert storage: `C:\Windows\system32\config\systemprofile\AppData\Roaming\Caddy` (copied from supachai profile 2026-08-30; cert valid to 2026-11-16) |
| `bridge` | Scheduled task `analytic-bridge` (ONLOGON, RU `analyticvps\supachai`, HIGHEST; NSSM variant retired 2026-08-30) | `powershell -File C:\analytic\bridge\scripts\run-bridge-task.ps1` → `C:\Python314\python.exe -m bridge`; runs in the console session (session 1) as the terminal-owning user; supervisor spawns one worker child per account | — (outbound Redis only) | `C:\analytic\bridge\logs\bridge-task.log` (wrapper tees stdout/stderr; worker output is block-buffered — check redis TTLs + `state\health\` for liveness, not logs) |

**Common NSSM config:** web/worker/caddy run as **LocalSystem** (deviation from
the original `analyticvps\supachai` — SUPACHAI_PASSWORD unavailable at the
2026-08-30 rebuild; reinstall under supachai when the password is provided),
`SERVICE_AUTO_START`, log rotation 10 MB online, `AppExit Default Restart`,
`AppRestartDelay 5000`, `AppThrottle 1500`, `AppStopMethodConsole 25000`.

**Dependencies:** `analytic-worker` + `analytic-web` →
`postgresql-x64-18` ONLY (Redis is not a Windows service anymore, so it cannot
be a DependOnService target — ordering is handled by the keepalive task + retry
loops); `caddy` → `analytic-web`. Bridge installs LAST (worker's MKSTREAM
consumer groups must exist before the bridge's first XADD).

**Ad-hoc single-service restart:** `nssm restart <svc>` — confirm first, then
verify per status-summary.md Phase 1. **Service control is nssm-only** for
every NSSM service above: no `sc.exe` stop/start/config, no `sc config`
autostart — startup type belongs to `nssm set <svc> Start ...` (sc.exe is
unusable from agent sessions; `nssm dump` hangs). Sole exception: native
(non-NSSM) `postgresql-x64-18` → `Restart-Service postgresql-x64-18`.

## Hazards & host-specific facts

- **PG16 hazard:** `postgresql-x64-16` is **disabled** (Stop + StartType
  Disabled, 2026-08-30) and its data dir is empty (no user DB was ever created
  there). NEVER re-enable it — it is configured for the SAME port 5432 and
  would clash with PG18 at boot. Uninstall still pending operator confirm.
- **Redis/WSL keepalive is load-bearing** — the Ubuntu distro terminates when
  its last `wsl.exe` session ends, killing the 6379 localhost relay (this is
  what took the site down 2026-08-30 02:31→15:47). The
  `analytic-redis-wsl-keepalive` ONLOGON task must stay enabled; it depends on
  the host auto-logging-in as `supachai`. If redis 6379 is unreachable, first
  check `wsl.exe -l -v` (Stopped = keepalive not running), then
  `systemctl is-active redis-server` inside Ubuntu.
- `nssm restart` can end at `SERVICE_STOPPED` despite reporting success —
  ALWAYS follow with `nssm status <svc>` and an explicit `nssm start <svc>` if
  not `SERVICE_RUNNING`.
- **Node is pinned** at `C:\nvm4w\nodejs\node.exe` (nvm4w; v24.18.0 at
  2026-08-18). `nvm use` switches what the services execute — node upgrades
  are a deliberate ops step, not a side effect.
- **Worker boot noise:** worker exits 1 if Redis is down at boot, so a few
  NSSM restart cycles right after boot are NORMAL; a persistent loop is not.
  Give the stack 5 minutes before declaring anything stuck post-reboot.

## Paths

- `C:\analytic` — the repo checkout (branch `main`) serving bridge + web + worker.
- `C:\analytic\.env` — `DATABASE_URL`, `REDIS_URL`, `TZ=Asia/Bangkok`. One var
  per line; multi-line values break dotenv.
- `C:\analytic\bridge\.env` — `REDIS_URL` + `BRIDGE_STATE_DIR` and
  `BRIDGE_STATE_DIR_WINDOWS`, both MUST equal `C:\analytic\bridge\state`.
- `C:\analytic\bridge\state\` — `health\<profile_id>.json`,
  `quarantine\<profile_id>.json`, `journal\<login>.sqlite3` (WAL, DACL-locked),
  `discovered-accounts\<login>.json`, `last_exit\<login>.json`,
  `locks\mt5n-login-<login>.lock`.
- `C:\analytic\dist\worker-v2.js`, `C:\analytic\dist\view-build-worker.js`,
  `C:\analytic\.next\standalone\server.js` — the runtimes NSSM starts.
- `C:\caddy\`, `C:\Python314\python.exe` (bridge Python, no venv).
- `C:\backups\` — `trading_db.dump` (refreshed) + dated `trading_db-*.dump`
  (keep 7) via the `analytic-pg-dump` scheduled task (daily 04:05; verified
  2026-08-30).
  `C:\Pause\` (paused terminal shortcuts),
  `C:\analytic-secrets.env` (REDIS_PASSWORD / SUPACHAI_DB_PASSWORD /
  AUTH_SECRET at install time).
- Startup folder: `C:\Users\supachai\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup`.

## MT5 terminals

- Portable `terminal64.exe`, launched ONLY via Startup `.lnk` at interactive
  logon. Bridge discovery matches only `/portable` or `-portable` in the live
  process command line; in portable mode `data_path` == terminal install dir.
- Terminal install roots are NOT in the repo. Resolve on-host from a Startup
  `.lnk` TargetPath or from `bridge\state\discovered-accounts\<login>.json`.
- Accounts at 2026-08-18 cutover (verify before relying): logins 7948784,
  7950622, 7953093, 7954220, 7998410 — all `ICMarketsSC-MT5-2`, all
  `brokerUtcOffsetMinutes=180`.

## Bridge exit codes (for `last_transition_reason` in health JSONs)

0 clean_shutdown · 10 config_invalid · 11 duplicate_ownership ·
12 identity_violation · 13 lease_lost · 14 mt5_ipc_failure ·
15 journal_failure · 16 journal_locked · 17 terminal_not_ready ·
20 unexpected_fatal.

`config_invalid` and `journal_failure` quarantine IMMEDIATELY;
`identity_violation` after >3 restarts in 600 s; `terminal_not_ready` backs
off with no ceiling. Backoff 1 s ×2 cap 300 s, +20 % jitter; 300 s stable
uptime resets. **Restarting the bridge does NOT clear quarantine by design** —
only `python -m bridge.scripts.clear_quarantine` (from `C:\analytic`) does.

## Known-stale documentation (don't get fooled)

| Where it says | Reality |
|---|---|
| Migration plan body: `postgresql-x64-16`, PG18 "on 5433" | Live is `postgresql-x64-18` on 5432 (plan audit notes correct the body) |
| Migration plan commands: `C:\Program Files\nodejs\node.exe` | Node lives at `C:\nvm4w\nodejs\node.exe` (audit note: Program Files path "does not exist on this box") |
| Docs claim worker health binds loopback | Code binds `0.0.0.0` (`src/worker-v2/health.ts:241`); firewall allows inbound only 80/443. Check `netstat -ano | findstr :9200` before asserting either |
| `install-service.ps1` header: `.\supachai` local account | Script sets `analyticvps\supachai` — confirm live with `nssm get bridge ObjectName` |
| Bridge health JSON fields `last_successful_live_poll_utc` / `last_successful_history_window_utc` | No live writer — always null-ish; do NOT build checks on them. Use Redis key TTL + worker health + XLEN growth |
| Old runbook claim: "`npm run start` serves a broken standalone" | Stale — `npm run build` now runs `scripts/sync-standalone.mjs` which fixes the standalone tree; NSSM runs `server.js` directly |
| CLAUDE.md references `.claude/skills/*` + `.claude/agents/*` in the analytic repo | Deleted by commit `e918803` (2026-08-20) — don't treat those paths as load-bearing |

## Unverified on host — check before first reliance

- ~~Reboot test + `analytic-pg-dump` task + `analytic-worker-health-probe`
  task~~ — **DONE 2026-08-30**: pg-dump + 5-min health probe registered and
  the dump verified (7.3 MB, LastTaskResult 0); the Aug 29 21:28 reboot test
  PASSED in production. A deliberate post-rebuild reboot test is still worth
  one operator-approved run (it also restarts the 5 MT5 terminals).
- Whether `npm run build:view-worker` is strictly required in deploys (added
  in 8.56; `sync-standalone.mjs` only WARNS when the bundle is missing —
  view builds silently fall back to slower inline mode). Deploy runbook runs
  it unconditionally before `npm run build` as cheap insurance.
- Exact terminal dirs / `<Category>` / chartNN↔EA mapping / terminal↔login
  table — read live from `.lnk` TargetPaths and `discovered-accounts\*.json`.
- PG18 bin path literal (`C:\Program Files\PostgreSQL\18\bin\`) — verify psql
  exists there before using it.
- Redis `requirepass` value lives only in env/secrets — never echo it.
