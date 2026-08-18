---
name: ssh-vps
description: Use when checking or controlling anything on the forexvps Windows VPS host over SSH — MT5 terminals, the Redis bridge service, or the analytic stack that runs on the same host (PostgreSQL, Redis in WSL2, analytic-web/analytic-worker NSSM services, Caddy). Covers status/health checks, restarting services, opening/closing terminals, pausing/resuming accounts, post-reboot verification, deploying code (git pull, rebuild, migrate), an SSH connection failing to forexvps, VPS status via iMessage, and editing EA chart inputs (.chr). Triggers include "check MT5 status", "is the bridge up", "เช็ค MT5", "เว็บลง", "เว็บไม่ขึ้น", "site down", "worker status", "postgres/redis on the VPS", "deploy on the VPS", "git pull on the VPS", "check terminals after reboot", "full restart forexvps", "restart everything on the VPS", "SSH connection refused/timeout to forexvps", "close terminal on forexvps", "ปิดบัญชี Jade", "เปิดบัญชี Jade".
---

# SSH VPS Ops

HOST: forexvps (1 host, Windows Server 2022, ssh alias in ~/.ssh/config).
CODE: C:\analytic. bridge entrypoint = `python -m bridge` (no args, auto-discovers accounts — bridge/accounts/*.json is an optional override, never required).
SERVICES on this host: nssm `bridge` (Python, talks to MT5) + the analytic stack — `postgresql-x64-18`, `redis-wsl` (NSSM wrapping WSL2 Redis), `analytic-web`, `analytic-worker`, `caddy`. See references/analytic-services.md for the full inventory.
Always confirm live state with `nssm status <svc>` on the host before assuming — don't trust this doc's snapshot over the host.

## Routing — read ONLY the matched file

| Trigger | File |
|---|---|
| status, "เช็ค MT5", is bridge up, stack/worker/web/postgres/redis health | references/status-check.md |
| open/close terminal (temp), pause/resume account | references/terminal-control.md |
| start/stop/restart bridge service | references/bridge-service.md |
| analytic stack services: what runs where, ports, logs, NSSM config | references/analytic-services.md |
| install bridge service (first time / nssm install) | references/service-install.md |
| repair bridge service (crash-loop, paused, stale config, "no such service" wasn't it) | references/service-repair.md |
| post-reboot / after Windows update | references/post-reboot-recovery.md |
| git pull / deploy (bridge code or web/worker stack) | references/deploy.md |
| full restart forexvps | references/full-restart.md |
| text/iMessage VPS status | references/imessage-summary.md |
| edit .chr / EA input param | references/chart-config.md |
| ssh fails, quoting error, garbled output | references/connection.md |

## Global safety (all actions)

- CONFIRM before: close terminal, restart bridge, reboot Windows/host, pause/resume, deploy, chart edit — an explicit command for that exact action ("restart the computer", "pause MT7", "deploy now") IS the confirmation, execute it directly. Ask only when intent is ambiguous, multiple interpretations exist, the action is unclear, or the user is asking for advice rather than instructing.
- NEVER: `taskkill /IM terminal64.exe` for a single named terminal (kills all — use PID). Launch `terminal64.exe` directly (always `.lnk`). Auto-accept a changed SSH host key. Print/echo the Redis password or any secret — includes `nssm get <svc> AppEnvironmentExtra`: it holds REDIS_URL/DATABASE_URL/AUTH_SECRET, so filter with `-match 'BRIDGE_STATE_DIR'` (or read only the key you need) instead of dumping the whole block. Overwrite, replace, or recreate any file inside the Startup folder or `C:\Pause` — only move existing `.lnk` files between them, or launch them; never write file content there.
- PAUSE ≠ temp close: bare name / "close account" / "ปิดบัญชี X" → pause (survives reboot). "terminal"/"temporarily" explicit → temp close only. Ambiguous → ask.
- Report results in plain language, not raw console dumps, unless asked to see raw output.
- Progress as short steps ("Pulling…", "Restarted, N terminals up"), not full command output.
