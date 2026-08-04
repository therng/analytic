---
name: ssh-vps
description: Use when checking or controlling MetaTrader 5 terminals and the Redis bridge service on the forexvps Windows VPS host over SSH — checking MT5/bridge/health status, restarting or stopping the bridge, opening/closing a terminal, permanently pausing or resuming an account, verifying terminals after a Windows reboot/update, deploying bridge code (git pull) and restarting, an SSH connection failing to forexvps, sending a VPS status summary via iMessage, or editing an EA's chart input parameters (.chr files). Triggers include "check MT5 status", "is the bridge up", "close terminal on forexvps", "open Boat", "ปิดบัญชี Jade", "เปิดบัญชี Jade", "resume Jade", "check terminals after reboot", "text me VPS status", "เช็ค MT5", "git pull on the VPS", "deploy the bridge update", "SSH connection refused/timeout to forexvps", "set autolot on Airisa", "turn strategy 4 off", "edit chart02.chr", "full restart forexvps", "restart everything on the VPS".
---

# SSH VPS Ops

HOST: forexvps (1 host, Windows Server 2022, ssh alias in ~/.ssh/config).
CODE: C:\analytic. bridge entrypoint = `python -m bridge` (no args, auto-discovers accounts — bridge/accounts/*.json is an optional override, never required).
SERVICE: nssm `bridge` is installed on forexvps. Per-account, not per-terminal (2 terminals same login → 1 child). Always confirm live state with `nssm status bridge` / `nssm get bridge AppParameters` before assuming — don't trust this doc's snapshot over the host.

## Routing — read ONLY the matched file

| Trigger | File |
|---|---|
| status, "เช็ค MT5", is bridge up | references/status-check.md |
| open/close terminal (temp), pause/resume account | references/terminal-control.md |
| start/stop/restart bridge service | references/bridge-service.md |
| install bridge service (first time / nssm install) | references/service-install.md |
| repair bridge service (crash-loop, paused, stale config, "no such service" wasn't it) | references/service-repair.md |
| post-reboot / after Windows update | references/post-reboot-recovery.md |
| git pull / deploy | references/deploy.md |
| full restart forexvps | references/full-restart.md |
| text/iMessage VPS status | references/imessage-summary.md |
| edit .chr / EA input param | references/chart-config.md |
| ssh fails, quoting error, garbled output | references/connection.md |

## Global safety (all actions)

- CONFIRM before: close terminal, restart bridge, reboot Windows/host, pause/resume, deploy, chart edit — an explicit command for that exact action ("restart the computer", "pause MT7", "deploy now") IS the confirmation, execute it directly. Ask only when intent is ambiguous, multiple interpretations exist, the action is unclear, or the user is asking for advice rather than instructing.
- NEVER: `taskkill /IM terminal64.exe` for a single named terminal (kills all — use PID). Launch `terminal64.exe` directly (always `.lnk`). Auto-accept a changed SSH host key. Print/echo the Redis password. Overwrite, replace, or recreate any file inside the Startup folder or `C:\Pause` — only move existing `.lnk` files between them, or launch them; never write file content there.
- PAUSE ≠ temp close: bare name / "close account" / "ปิดบัญชี X" → pause (survives reboot). "terminal"/"temporarily" explicit → temp close only. Ambiguous → ask.
- Report results in plain language, not raw console dumps, unless asked to see raw output.
- Progress as short steps ("Pulling…", "Restarted, N terminals up"), not full command output.
