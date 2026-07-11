# VPS command reference

Both hosts (`icvps`, `forexvps`) are Windows Server 2022, reached via `ssh <host> '<remote command>'` through Desktop Commander's real local shell. The bridge codebase is deployed at `C:\analytic\bridge` on each host (per the nssm install command in `bridge/README.md`), run as an nssm service named `MT5Bridge`, with Python typically at `C:\Python314\python.exe`. Confirm the exact Python path once per host if a command fails with "not found" — it may differ between hosts.

Quoting convention below: outer `'...'` wraps the whole remote command so the local shell (bash/zsh) passes it through untouched; inner `"..."` is Windows-side quoting for arguments containing spaces. Adjust if the user's actual shell/alias behaves differently — test with a harmless command like `ssh icvps 'whoami'` first if anything seems off.

## 1. Check running MT5 terminals

Preferred — `Get-Process` gives PID, name, and full path in one shot, verified working over SSH:

```
ssh icvps 'powershell -NoProfile -Command "Get-Process terminal64 | Select-Object Id, ProcessName, Path"'
```

Example output:

```
  Id ProcessName Path
  -- ----------- ----
 756 terminal64  C:\MT5\terminal64.exe
3108 terminal64  C:\MT19\terminal64.exe
```

If no terminals are running, `Get-Process` errors with `Cannot find a process with the name "terminal64"` — treat that as "0 terminals running" rather than a command failure.

`tasklist` also works if `Get-Process`/PowerShell is unavailable for some reason:

```
ssh icvps 'tasklist /FI "IMAGENAME eq terminal64.exe" /FO TABLE'
```

Note the `Path` (or PID) for anything you'll need to close or cross-reference later.

## 2. Discover expected/portable terminal paths and friendly names

The Startup folder holds one `.lnk` shortcut per configured terminal, and each shortcut's filename is a human-friendly label the user recognizes (trader/account nickname) — use these names when talking to the user instead of raw paths or PIDs where possible.

List the shortcuts:

```
ssh icvps 'powershell -NoProfile -Command "dir \"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\""'
```

Example output:

```
Mode    LastWriteTime      Length Name
----    -------------      ------ ----
-a---- 4/5/2026  6:35 PM      945 Airisa.lnk
-a---- 6/12/2026 2:46 PM     1003 Airisa2.lnk
-a---- 7/2/2026  1:01 AM      956 Boat.lnk
-a---- 4/5/2026  7:57 PM      945 Eak.lnk
```

Resolve one shortcut's target path (verified working — WScript.Shell COM object, one shortcut at a time):

```
ssh icvps 'powershell -NoProfile -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut(\"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Boat.lnk\"); $Shortcut.TargetPath; $Shortcut.Arguments"'
```

This prints `TargetPath` (the `terminal64.exe` path) and `Arguments` (should contain `/portable` — if it doesn't, that shortcut won't be picked up by `discover_terminals.py` and the bridge won't manage it). Repeat per shortcut name, or loop over all `.lnk` files in one call:

```
ssh icvps 'powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; Get-ChildItem \"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\" -Filter *.lnk | ForEach-Object { $sc = $ws.CreateShortcut($_.FullName); [PSCustomObject]@{ Name=$_.BaseName; TargetPath=$sc.TargetPath; Arguments=$sc.Arguments } }"'
```

Cross-reference the resulting name → path map against step 1's running-process list (matched by `Path`) to see which named terminals (e.g. "Boat", "Eak") are up vs. down.

Authoritative alternative — same filtering logic `discover_terminals.py` uses (only returns `/portable` shortcuts, no friendly names though), if Python is reachable over SSH:

```
ssh icvps '"C:\Python314\python.exe" "C:\analytic\bridge\discover_terminals.py"'
```

## 3. Bridge (nssm) service status

```
ssh icvps 'nssm status MT5Bridge'
```

Fallback (built into Windows, no nssm dependency):

```
ssh icvps 'sc query MT5Bridge'
```

`SERVICE_RUNNING` / `SERVICE_STOPPED` appear in the `sc query` output under `STATE`.

## 4. Start / stop / restart the bridge service

```
ssh icvps 'nssm start MT5Bridge'
ssh icvps 'nssm stop MT5Bridge'
ssh icvps 'nssm restart MT5Bridge'
```

Restart triggers `run_all.py`'s graceful shutdown (`CTRL_BREAK_EVENT` to each bridge subprocess, so Redis locks release cleanly) then fresh discovery + respawn of every terminal.

## 5. Close an MT5 terminal

All terminals on the host:

```
ssh icvps 'taskkill /IM terminal64.exe /F'
```

One specific terminal by PID (get the PID from step 1 first):

```
ssh icvps 'taskkill /PID 12345 /F'
```

Closing a terminal that the bridge is actively watching will surface as `mt5.initialize failed` in the bridge's log and the bridge process will eventually exit/backoff — this is expected, not an error to chase.

## 6. Open an MT5 terminal (without restarting the whole bridge service)

Always launch via its Startup-folder `.lnk` shortcut, not by calling `terminal64.exe` directly with `/portable`. The shortcut already encodes the correct path and arguments — launching the `.exe` directly risks missing `/portable` or pointing at the wrong data folder, and it won't match what runs on a normal login/reboot.

```
ssh icvps 'powershell -NoProfile -Command "Start-Process \"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Boat.lnk\""'
```

Swap `Boat.lnk` for the shortcut name the user asked for (resolve fuzzy/partial names against the listing from step 2 first).

## 6b. List paused accounts

```
ssh icvps 'powershell -NoProfile -Command "if (Test-Path C:\Pause) { dir C:\Pause } else { Write-Output \"C:\Pause does not exist yet\" }"'
```

Run alongside step 2 (Startup folder listing) whenever reporting status, so paused accounts are labeled "paused" instead of "missing/down".

## 6c. Pause an account (kill + move shortcut to C:\Pause — survives reboot)

Trigger phrasing: "close account X", "ปิดบัญชี X", or a bare name like "ปิด Jade" (no "terminal"/"temporarily" qualifier). **Target only that one terminal's PID** — a host usually runs several terminals for different accounts, and pausing one must not touch the others. Resolve the shortcut name to its `TargetPath` (step 2), match that path against the running-process list (step 1) to get the PID, then:

```
ssh icvps 'taskkill /PID 12345 /F'
```

Then move the shortcut:

```
ssh icvps 'powershell -NoProfile -Command "New-Item -ItemType Directory -Force -Path C:\Pause | Out-Null; Move-Item \"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Jade.lnk\" -Destination C:\Pause -Force"'
```

Swap `Jade.lnk` for the resolved shortcut name. `New-Item -Force` is a no-op if `C:\Pause` already exists, so it's safe to run every time. If the terminal wasn't running when the pause was requested, skip the `taskkill` step and just move the shortcut.

## 6d. Resume a paused account (move shortcut back + relaunch)

Trigger phrasing: "เปิดบัญชี X", "resume X", "un-pause X".

```
ssh icvps 'powershell -NoProfile -Command "Move-Item \"C:\Pause\Jade.lnk\" -Destination \"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\" -Force; Start-Process \"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Jade.lnk\""'
```

## 7. Redis heartbeat check (optional, most authoritative liveness signal)

Read `REDIS_URL` from `analytic/bridge/.env` locally if present — never hardcode the password in this skill or in chat output. If no local `.env` is available, ask the user once for the value rather than guessing or reusing a value seen elsewhere.

Run remotely using the bridge's own Python/redis install (avoids needing `redis-cli` on the Mac or the VPS):

```
ssh icvps '"C:\Python314\python.exe" -c "import os,redis; from dotenv import load_dotenv; load_dotenv(r\"C:\analytic\bridge\.env\"); r=redis.from_url(os.environ[\"REDIS_URL\"], decode_responses=True); print(sorted(r.keys(\"mt5:bridge:heartbeat:*\")))"'
```

A login with no `mt5:bridge:heartbeat:{login}` key is either not running or stuck — cross-reference with step 1's process list to tell the two apart (process absent = not running; process present but no heartbeat = stuck, worth a targeted restart).

## 8. iMessage summary

Use the `Read_and_Send_iMessages` MCP's `send_imessage` tool. Default recipient (send-to-self): `+66899619717`. Example message shape:

```
VPS check — icvps: 2/2 terminals up, MT5Bridge running, all heartbeats fresh.
forexvps: 1/2 terminals up, MT5Bridge running, login 12345678 heartbeat missing.
```

Keep it to a few lines; this is a phone notification, not a report.

## 9. After a Windows update / host restart

Every `.lnk` in the Startup folder is a terminal that's expected to be running 24/7 — the Startup folder is the full "should be up" list, not an optional convenience. Windows Update can restart these hosts unattended. Startup-folder items only auto-launch on an interactive user logon, which is not guaranteed to happen automatically after an unattended reboot (depends on whether auto-logon is configured on that host) — so a restart is the single most likely cause of "terminal was up yesterday, isn't now."

After any known or suspected restart:

1. List the Startup folder shortcuts (step 2) — this is the full expected set.
2. List running `terminal64.exe` processes (step 1).
3. For every shortcut with no matching running process, launch it via `Start-Process` on its `.lnk` (step 6).
4. Confirm the `MT5Bridge` service is running too (step 3) — restart it if not (step 4).

Treat "fewer running terminals than shortcuts in the Startup folder" as the default sign to check for a recent restart, not just as "some terminal crashed."

## 10. Deploy code changes (git pull) and restart the bridge

Pull the latest `bridge/` code from the repo's default branch at `C:\analytic`, then restart the service so it picks up the change:

```
ssh icvps 'powershell -NoProfile -Command "cd C:\analytic; git pull"'
```

Read the output for merge conflicts or a detached-HEAD/dirty-worktree warning before restarting — a failed or partial pull should not be followed by a restart, since that would just relaunch the old (or now-inconsistent) code. If the pull reports "Already up to date.", a restart is still safe but not required.

Once the pull succeeds, restart the service (step 4) so the new code takes effect:

```
ssh icvps 'nssm restart MT5Bridge'
```

For "update both hosts", run the pull + restart pair against `icvps` first, confirm it came back healthy (step 3 status, optionally step 1 process list), then repeat against `forexvps` — don't fire both in parallel blind, so a bad pull on one host doesn't get masked by the other host looking fine.
