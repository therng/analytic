---
name: ssh-vps
description: Use when checking or controlling MetaTrader 5 terminals and the Redis bridge service on the icvps or forexvps Windows VPS hosts over SSH — checking MT5/bridge/heartbeat status, restarting or stopping the bridge, opening/closing a terminal, permanently pausing or resuming an account, verifying terminals after a Windows reboot/update, deploying bridge code (git pull) and restarting, an SSH connection failing to icvps/forexvps, or sending a VPS status summary via iMessage. Triggers include "check MT5 status", "is the bridge up", "restart bridge on forexvps", "close terminal on icvps", "open Boat", "ปิดบัญชี Jade", "เปิดบัญชี Jade", "resume Jade", "check terminals after reboot", "text me VPS status", "เช็ค MT5", "git pull on the VPS", "deploy the bridge update", "ssh to icvps", "SSH connection refused/timeout to forexvps".
---

# SSH VPS Ops

Two Windows VPS hosts, `icvps` and `forexvps`, reachable over SSH (key-based, aliases already in `~/.ssh/config`). Each runs one or more portable MT5 terminals plus a Python supervisor (`run_all.py`) installed as the nssm service `MT5Bridge`, streaming account/position data to Redis. Code lives at `C:\analytic` on each host. Full exact command strings: `references/vps-commands.md` — read it before running anything unfamiliar.

## Prerequisites

- Run remote commands through the Desktop Commander MCP's real local terminal (`start_process`/`interact_with_process`), not the sandboxed Bash tool — Bash has no route to these hosts or keys.
- One-shot form: `ssh icvps "<command>"`. PowerShell commands nested inside carry their own quoting — see reference file for tested examples. Sanity-check with `ssh icvps 'whoami'` first if anything seems off.
- Never hardcode the Redis password. Read `REDIS_URL` from `analytic/bridge/.env` locally if present; otherwise ask the user once, don't write it anywhere ungitignored.

## SSH connection trouble

| Symptom | Likely cause | What to do |
|---|---|---|
| `Connection timed out` / no route | Host down, VPN/firewall, wrong IP in `~/.ssh/config` | Report which host failed. Don't retry silently more than once. |
| `Permission denied (publickey)` | Key removed/rotated, wrong user in config | Report the exact error; don't fall back to password auth or guess credentials. |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` / host key warning | VPS was rebuilt/reimaged, or MITM | **Stop.** Don't auto-accept (`-o StrictHostKeyChecking=no`) or edit `known_hosts` without telling the user — confirm the host was legitimately rebuilt first. |
| Command runs but returns nothing / hangs | PowerShell command missing `-NoProfile` or unclosed quote | Check quoting against `references/vps-commands.md` examples; test with `whoami` first. |

## Quick reference

| Action | Trigger phrasing | Section below |
|---|---|---|
| Status check | "check MT5 status", "is bridge up", "เช็ค MT5" | 1 |
| Temporary close/open (survives as auto-start) | "close terminal on X", "open Boat" | 2 |
| Permanent pause/resume (won't auto-start) | "close account X", "ปิดบัญชี X", "resume X" | 3 |
| Bridge service control | "restart bridge", "restart MT5Bridge" | 4 |
| Post-reboot recovery | "check terminals after reboot/update" | 5 |
| Deploy code | "git pull on VPS", "deploy the bridge update" | 6 |
| Status via iMessage | "text me VPS status" | 7 |

## Actions

### 1. Check status

Per host (default both, unless the user names one):

1. `Get-Process terminal64` — PID + path per running terminal.
2. List Startup-folder `.lnk` shortcuts, resolve each target via `WScript.Shell` — shortcut filenames are the human-friendly names ("Boat", "Eak", "Airisa"). Match against step 1's paths to report named terminals up/down, not just a count.
3. `nssm status MT5Bridge` (fall back to `sc query MT5Bridge` if nssm isn't on PATH).
4. Optionally cross-check Redis: `mt5:bridge:heartbeat:*` keys. Missing heartbeat for a login that should be live = that bridge process is stuck, even if the service shows running.

Also list `C:\Pause` so paused accounts are reported as "paused", not "down/missing".

Summarize per host by name: "icvps: Boat and Eak up, Airisa2 down, Jade paused."

### 2. Close or open a terminal — temporary

Use when the user wants a terminal stopped/started without saying "account" or "ปิดบัญชี" — the shortcut stays in Startup, so it auto-returns on next login/reboot/bridge-restart.

- **Close**: kill `terminal64.exe`. If several terminals run and the user wants one, get its PID from `Get-Process` (matched via shortcut resolution) and kill by PID, not all `terminal64.exe`.
- **Open**: always launch the Startup-folder `.lnk` (`Start-Process` on the `.lnk`), never `terminal64.exe` directly — the shortcut carries the right path and `/portable` arg. Resolve a named request ("open Boat") to its shortcut first.
- Restarting `MT5Bridge` also relaunches every discovered terminal — mention as the heavier "bring everything back" option.

### 3. Pause or resume an account — permanent

Use for "close account X", "ปิดบัญชี X", or a bare name with no "temporarily" qualifier — this means stop and keep stopped.

1. Kill that terminal's `terminal64.exe` (same as temporary close).
2. Move its `.lnk` from Startup into `C:\Pause` — drops it from `discover_terminals.py`'s output too, so a bridge restart won't respawn it.

Confirm the name resolves to exactly one shortcut before acting — ask if ambiguous.

**Resume**: move the `.lnk` back from `C:\Pause` to Startup, then launch it (step 2's open). An already-running bridge subprocess for a paused terminal isn't force-stopped by the move alone — it exits naturally once its terminal is gone, or clears on the next `MT5Bridge` restart. Mention as a follow-up, don't do automatically.

### 4. Start, stop, or restart the bridge service

`nssm start|stop|restart MT5Bridge`. Restart = graceful shutdown of every subprocess (`CTRL_BREAK_EVENT`, Redis locks release cleanly) then fresh discovery + respawn. Right move after `.env` changes, after closing a terminal that needs to come back, or when heartbeats look stuck.

### 5. Recover after a Windows update or restart

Every `.lnk` in Startup is a terminal expected up 24/7 — that folder is the full "should be running" checklist. Unattended reboots don't guarantee Startup auto-launch. "Fewer terminals running than shortcuts exist" is the default sign to suspect a restart, not an isolated crash.

Flow: list Startup (expected) → list running processes (actual) → launch any shortcut with no matching process → confirm `MT5Bridge` is running.

### 6. Deploy code changes and restart

For "git pull on VPS", "update/deploy the bridge": `cd C:\analytic; git pull`, read output for conflicts or a dirty/detached worktree before doing anything else — a failed pull must not be followed by a restart. Clean pull (including "Already up to date.") → `nssm restart MT5Bridge`.

For both hosts: sequential, not parallel — pull + restart `icvps`, confirm healthy, then `forexvps`. A bad pull on one host must not be masked by the other looking fine.

### 7. Send an iMessage status summary

After a check or action, offer to text via `Read_and_Send_iMessages`'s `send_imessage`. Default recipient: `+66899619717`. Compact: host, terminal count, service state, anything needing attention. Only send if asked or previously requested — no unsolicited texts for routine checks.

## Common mistakes

- Launching `terminal64.exe` directly with a hand-built `/portable` flag instead of the `.lnk` shortcut — risks wrong data folder or missing arg.
- Killing all `terminal64.exe` processes on a host when the user named one specific terminal.
- Treating a paused account (in `C:\Pause`) as "down" instead of "paused" in a status report.
- Restarting the bridge or closing a terminal without confirming first, when the user only asked for a status check.
- Auto-accepting a changed SSH host key instead of stopping to confirm the host was legitimately rebuilt.

## Safety notes

- These are production trading terminals expected to run continuously. Confirm before closing a terminal or restarting the bridge if the user didn't explicitly ask for that action.
- Pause is a bigger commitment than temporary close — survives reboots, drops the account from bridge management. Default to pause for a bare name or "close account"; temporary close only when "terminal"/"temporarily" is explicit. Ask if genuinely mixed signals.
- Unreachable host: say so plainly, don't retry silently more than once, report which host failed.
- Report command output in plain language, not raw console dumps, unless the user asks to see raw output.
