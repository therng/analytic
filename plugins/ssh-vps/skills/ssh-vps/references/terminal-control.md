WHEN: "close terminal on X", "open Boat" (temp) | "close account X", "ปิดบัญชี X", "resume X", bare name (permanent).

**SSH command patterns:** See command-execution-strategy.md (Tier 1 for all commands — single-quoted SSH + PowerShell).

FIND PID FOR NAME (needed by CLOSE/PAUSE):
`ssh forexvps 'powershell -NoProfile -Command "Get-Process terminal64 | Select-Object Id, ProcessName, Path"'` → match `Path` against:
`ssh forexvps 'powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; Get-ChildItem \"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\" -Filter *.lnk | ForEach-Object { $sc = $ws.CreateShortcut($_.FullName); [PSCustomObject]@{ Name=$_.BaseName; TargetPath=$sc.TargetPath } }"'`

TEMP CLOSE (auto-returns on next login/reboot/bridge-restart):
`ssh forexvps 'taskkill /PID <pid> /F'`
FORBIDDEN: `taskkill /IM terminal64.exe /F` when user named one terminal (kills all).

TEMP OPEN (Tier 2 — complex path handling):
```bash
ps_script='Start-Process -FilePath "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\<Name>.lnk"'
encoded=$(printf '%s' "$ps_script" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')
ssh forexvps "powershell -NoProfile -EncodedCommand '$encoded'"
```
FORBIDDEN: launching `terminal64.exe` directly (wrong data folder / missing `/portable` risk).

PAUSE (permanent, survives reboot, drops from bridge management):
1. Kill PID (as TEMP CLOSE). Not running → skip, go to 2.
2. Move shortcut (Tier 2 — complex with env var):
```bash
ps_script='New-Item -ItemType Directory -Force -Path C:\Pause | Out-Null; Move-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\<Name>.lnk" -Destination C:\Pause -Force'
encoded=$(printf '%s' "$ps_script" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')
ssh forexvps "powershell -NoProfile -EncodedCommand '$encoded'"
```
Confirm name → exactly 1 shortcut before acting; ask if ambiguous.

RESUME (Tier 2 — complex path operations):
```bash
ps_script='Move-Item "C:\Pause\<Name>.lnk" -Destination "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup" -Force; Start-Process -FilePath "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\<Name>.lnk"'
encoded=$(printf '%s' "$ps_script" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')
ssh forexvps "powershell -NoProfile -EncodedCommand '$encoded'"
```
NOTE: an already-running bridge subprocess for the paused terminal isn't force-killed by the move — clears on its own or next bridge restart. Mention, don't auto-restart.

PAUSE-vs-TEMP rule: see SKILL.md global safety.

BATCH (2+ pause/resume/enable/disable requested together) — PERSISTENT CONFIG:
1. Move every requested `.lnk` (Pause↔Startup, PAUSE/RESUME steps above minus the Start-Process call) — no launches, no restarts between moves.
2. Verify: `ssh forexvps 'powershell -NoProfile -Command "dir \"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\"; dir C:\Pause"'`  — each `.lnk` in its expected folder.
3. Do any other requested work.
4. If user asked changes to take effect now: `ssh forexvps 'powershell -NoProfile -Command "Restart-Computer -Force"'` — once, only after step 1-3 complete.
5. Windows Startup launches the enabled terminals — this is the sole commit mechanism for a batch.

FORBIDDEN during a batch: restarting Windows between moves. Launching any terminal (`.lnk` or `.exe`) manually. Restarting a single terminal mid-batch.
