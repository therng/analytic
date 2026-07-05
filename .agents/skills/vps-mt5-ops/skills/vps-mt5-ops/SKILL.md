---
name: vps-mt5-ops
description: Check and control MetaTrader 5 terminals and the Redis bridge service running on the icvps and forexvps Windows VPS hosts, then optionally text a status summary via iMessage. Use when the user asks to check MT5 status, check if the bridge is running, check bridge/heartbeat health, restart/stop/start the bridge service, open or close an MT5 terminal temporarily, permanently pause or resume a trading account so it stops (or starts) auto-launching on reboot, verify all terminals came back up after a Windows update/restart, or wants a status update sent to their phone. Triggers include "check MT5 status", "is the bridge up", "restart the bridge on forexvps", "close the MT5 terminal on icvps", "open MT5 terminal", "open Boat", "close account Jade", "ปิดบัญชี Airisa2", "ปิด Jade", "เปิดบัญชี Jade", "resume Jade", "check terminals after the reboot", "text me the VPS status", "เช็ค MT5", "รีสตาร์ท bridge", "ปิด terminal บน icvps", "เปิด terminal", "เช็คหลัง restart windows".
---

# VPS MT5 Ops

Operate the MT5 Bridge system (see `bridge/README.md` in the `analytic` project) running on two Windows VPS hosts reachable over SSH: `icvps` and `forexvps`. Both run one or more portable MT5 terminals plus a Python supervisor (`run_all.py`) installed as an nssm Windows service named `MT5Bridge`, which streams account/position data to Redis at `therng.duckdns.org:6379`.

Full exact command strings for every action below live in `references/vps-commands.md` — read that file before running anything unfamiliar. This file covers the workflow and decision points.

## Prerequisites

- Run all remote commands through the Desktop Commander MCP's real local terminal (`start_process` / `interact_with_process`), not the sandboxed Bash tool — the user's Mac already has SSH key-based access configured for the `icvps` and `forexvps` host aliases in `~/.ssh/config`. The sandboxed Bash tool has no route to these hosts and no keys.
- A one-shot remote command takes the form `ssh icvps "<command>"`. Quote carefully — PowerShell commands nested inside an SSH command need their own quoting; see the reference file for tested examples.
- If a Redis heartbeat check is needed and `redis-cli` isn't available locally, either run the check remotely over SSH (redis-cli is not required there either — use the discovery command in the reference file) or skip the heartbeat check and rely on the process + service checks.
- Never hardcode the Redis password. If `REDIS_URL` is needed, read it from `analytic/bridge/.env` if that file exists locally; otherwise ask the user for it once and don't write it into any file that isn't gitignored.

## Actions

### 1. Check status

For each host the user cares about (default: both `icvps` and `forexvps` unless they name one):

1. List running `terminal64.exe` processes with `Get-Process` (returns PID + full path in one call) — tells you how many MT5 terminals are currently up and which install path each one is running from.
2. List the Startup-folder shortcuts (`.lnk` files) and resolve each one's target path via the `WScript.Shell` COM object — shortcut filenames are human-friendly names the user already recognizes (e.g. "Boat", "Eak", "Airisa"), not raw account numbers. Match these against the running-process paths from step 1 to tell the user which *named* terminals are up vs. down, instead of just a bare count.
3. Query the `MT5Bridge` nssm service status (`nssm status MT5Bridge`, fall back to `sc query MT5Bridge` if `nssm` isn't on PATH over SSH).
4. Optionally cross-check Redis: scan for `mt5:bridge:heartbeat:*` keys. A missing heartbeat for a login that should be live means that specific bridge process is stuck or dead even if the Windows service shows "running" — the service can be up while an individual terminal's bridge is wedged.

Also list `C:\Pause` (step in `references/vps-commands.md`) so paused accounts are reported correctly ("Jade is paused", not "Jade is down/missing") rather than flagged as an unexpected outage.

Summarize per host by name where possible (e.g. "icvps: Boat and Eak up, Airisa2 down, Jade paused"), plus service state and heartbeat health if checked.

### 2. Close or open a terminal — temporary (still auto-starts on next login/restart)

Use this when the user wants a terminal stopped or started but did **not** say "account", "ปิดบัญชี", or otherwise imply it should stay off. This is the lighter-weight action — the shortcut stays in the Startup folder, so the terminal comes back on the next login/reboot or bridge restart.

- **Close**: kill `terminal64.exe` on the target host. If the user wants a specific terminal and there's more than one running, get its PID from the `Get-Process` output first (matched by path or by resolving the shortcut name) and kill by PID rather than killing all `terminal64.exe` processes on that host.
- **Open**: always launch via the terminal's Startup-folder `.lnk` shortcut (`Start-Process` on the `.lnk`, not on `terminal64.exe` directly) — the shortcut already encodes the right path and `/portable` argument, and it's the same mechanism the host would use on a normal login. Do not launch `terminal64.exe` directly with a hand-built `/portable` argument; the shortcut is the source of truth. If the user names the terminal by its shortcut name (e.g. "open Boat"), resolve that to the shortcut file first via the Startup-folder listing.
- Note: the bridge's own `mt5.initialize(path=...)` call will *also* launch the terminal automatically if it isn't already running. So restarting the `MT5Bridge` service is a valid (if heavier) way to bring every discovered terminal back up at once — mention this as an option when the user wants "restart everything" rather than one specific terminal.

### 3. Pause or resume an account — permanent (won't auto-start until resumed)

Use this when the user says **"close account X"**, **"ปิดบัญชี X"**, or just names an account/terminal without qualifying it as temporary (e.g. "ปิด Jade") — this phrasing means stop it and keep it stopped, not just kill the process for now. Two-step, both required:

1. Kill the terminal's `terminal64.exe` process (same as the temporary close above).
2. Move that terminal's `.lnk` shortcut out of the Startup folder into `C:\Pause` on the same host — this is what makes it *not* come back on the next reboot or login, and it also drops out of `discover_terminals.py`'s output, so the next bridge restart won't spawn a bridge process for it either.

Confirm the account name resolves to exactly one shortcut before doing anything irreversible-feeling — ask the user if a name is ambiguous or not found.

**Resume** ("เปิดบัญชี X", "resume X", "un-pause X") is the mirror image: move the `.lnk` back from `C:\Pause` into the Startup folder, then launch it the same way as a normal open (step 2 above). This is the logical inverse of pausing, kept in this skill so a paused account isn't a dead end — confirm this naming works for the user if it ever comes up ambiguously.

An already-running bridge subprocess for a paused terminal isn't force-stopped by moving the shortcut alone — it will naturally back off/exit once its terminal is gone (`mt5.initialize failed`), or clears immediately on the next `MT5Bridge` restart. Mention this as a follow-up option, don't do it automatically.

### 4. Start, stop, or restart the bridge service

Use `nssm start|stop|restart MT5Bridge` on the target host. A restart triggers a graceful shutdown of every bridge subprocess (`CTRL_BREAK_EVENT`, so Redis locks get released cleanly) followed by fresh terminal discovery and respawn — this is the right move after changing `.env`, after a terminal was closed and needs to come back, or when heartbeats look stuck.

### 5. Recover after a Windows update or host restart

**Every `.lnk` shortcut in the Startup folder is a terminal that's expected to be running 24/7** — treat that folder's contents as the full "should be up" checklist, not optional extras. Windows Update can restart these hosts unattended, and Startup-folder items only auto-launch on an interactive logon (not guaranteed after an unattended reboot). So "fewer terminals running than shortcuts exist" is the default sign to suspect a recent restart, not just an isolated crash.

Recovery flow: list the Startup folder (full expected set) → list running `terminal64.exe` processes (actual set) → for each shortcut with no matching process, launch it via its `.lnk` → confirm `MT5Bridge` is running too.

### 6. Send an iMessage status summary

After a status check or an action, offer to text a short summary via the `Read_and_Send_iMessages` MCP tool (`send_imessage`). Default recipient (send-to-self): `+66899619717`. Keep the message compact — host, terminal count, service state, and anything that needs attention. Only send if the user asked for it or previously indicated they want notifications; don't send unsolicited texts for routine checks unless asked.

## Safety notes

- These are production trading terminals expected to run continuously. Confirm with the user before closing a terminal or restarting the bridge service if they didn't explicitly ask for that action — a routine "check status" request should never itself change anything.
- Bringing a terminal back up always means launching its `.lnk` shortcut, never hand-constructing a `terminal64.exe /portable` command.
- Pause (moving a `.lnk` to `C:\Pause`) is a bigger commitment than a temporary close — it survives reboots and drops the account from bridge management. Default to pause for a bare name or "close account" (that's how the user actually phrases it); only treat it as a temporary close when "terminal" or "temporarily" is explicit. If genuinely mixed signals, ask before picking the permanent option.
- If a host is unreachable over SSH, say so plainly (don't retry silently more than once) and report which host failed.
- Report exact command output back to the user in plain language rather than raw console dumps, unless they ask to see the raw output.
