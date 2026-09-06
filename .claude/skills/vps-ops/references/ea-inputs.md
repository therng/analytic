# ea-inputs — edit an EA's chart input parameters

MT5 Expert Advisor inputs on this host are stored in the terminal's chart
profile files (`.chr`). There is exactly ONE supported mechanism: **edit the
`.chr`, restart the terminal**. No runtime reload path exists on this setup,
the MT5 Python API cannot touch chart/EA config (the bridge adapter is capped
at read-only account/history calls), and UI automation is untested — don't
improvise either.

This is a confirm-first operation: state the terminal, the EA, the parameter,
old value → new value, and that the terminal will restart (open positions
unmanaged briefly, live feed gap ~60 s) — then wait for the yes.

Prerequisite: platform guard passed (see SKILL.md) — if not yet run this
session, run it now, before any command.

## Step 1 — resolve the terminal and its chart file

Terminal dirs are not written down anywhere central. Resolve from the Startup
`.lnk`:

```powershell
$ws = New-Object -ComObject WScript.Shell
Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\*.lnk" |
  ForEach-Object { "{0} -> {1}" -f $_.Name, $ws.CreateShortcut($_.FullName).TargetPath }
```

(Or cross-reference `C:\analytic\bridge\state\discovered-accounts\<login>.json`
to map login → terminal dir.) Chart profiles live at:

```
<TerminalDir>\MQL5\Profiles\Charts\<Category>\chartNN.chr
```

## Step 2 — READ FIRST, never trust a stated value

```powershell
Select-String -Path "<chart.chr>" -Pattern "name=|Inp" -Encoding Unicode
```

Confirm the EA `name=` line and the CURRENT value of the target `Inp*` key
before touching anything. If the key or expected EA name doesn't appear,
STOP — wrong file or wrong understanding; report what you found.

## Step 3 — stop the terminal (by PID, never /IM)

A running terminal overwrites the edit with its own in-memory state on save
or exit. Resolve the PID for exactly that terminal:

```powershell
Get-Process terminal64 | Select-Object Id, Path
taskkill /PID <pid> /F
```

Pick the `Id` whose `Path` column EXACTLY equals the terminal directory
resolved in Step 1 (`bridge\state\discovered-accounts\<login>.json` confirms
the same dir per login). Zero matches or several matches → STOP and report;
do not guess and do not take the first PID — this host runs ~5 terminals and
the wrong kill leaves the target terminal running, which will overwrite the
edit on its next save.

NEVER `taskkill /IM terminal64.exe` — it kills every terminal on the host.

## Step 4 — back up the file

```powershell
Copy-Item "<chart.chr>" "<chart.chr>.bak_<yyyyMMdd-HHmm>" -Force
```

Keep the backup until the terminal is verified healthy post-restart, then
delete it.

## Step 5 — edit with exact encoding handling

`.chr` files are **UTF-16LE + BOM, CRLF line endings**. Plain
`Get-Content`/`Set-Content` or naive `-replace` mangles them. Match the full
line INCLUDING the newline — that anchors the replace to end-of-line without
regex `$` (which CRLF defeats). The replace itself is still silent on
no-match; Step 6's re-read is the real check:

```powershell
$nl = [System.Environment]::NewLine
$p  = "<chart.chr>"
$c  = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::Unicode)
$n  = $c.Replace("InpAutoLotsValue=3" + $nl, "InpAutoLotsValue=4" + $nl)
[System.IO.File]::WriteAllText($p, $n, [System.Text.Encoding]::Unicode)
```

FORBIDDEN, each for a verified reason:
- `$`-anchored regex (`-replace 'InpX=3$'`) — CRLF puts `\r` before `$` →
  silent no-match, exit 0, nothing changed.
- Backtick `` `r`n `` escapes — mangled when the command crosses shells.
- Trusting the exit code alone — `.Replace()` that matched nothing is a
  silent no-op with exit 0. Verification is re-reading the file.

## Step 6 — verify the file changed

Re-run the Step 2 `Select-String` and eyeball the new value. This proves the
file changed — NOT that the EA honors it (`chartNN` only takes effect if it
is the profile the terminal opens on launch; confirm the file you edited is
the active chart).

## Step 7 — relaunch via the Startup .lnk (never terminal64.exe direct)

```powershell
Start-Process "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\<Name>.lnk"
Start-Sleep -Seconds 5
Get-Process terminal64 | Select-Object Id, Path   # confirm it's up
```

Direct `terminal64.exe` launches miss the portable profile wiring — don't.

## Step 8 — verify the stack re-attached

Bridge discovery re-finds the relaunched terminal within its 30 s rescan;
the Redis live key (`mt5:account:{<login>}:live` — braces around the login
are PART of the key, Redis hash tags; 60 s TTL) reappears. Confirm via
`C:\analytic\bridge\state\health\<profile_id>.json` → `state: running`
and a fresh `last_transition_at_utc` before reporting done.

## Terminal pause/resume (related, same safety rules)

- PAUSE (stop auto-launch on reboot) = `mt5ops.py pause MT<x>` — moves the
  `.lnk` to `C:\Pause` only; the running terminal is unaffected. To also stop
  it now, follow with `mt5ops.py term close MT<x>`.
- RESUME = `mt5ops.py resume MT<x>` (moves the `.lnk` back); the terminal
  itself starts on next reboot, or now via `term start`.
- Never write file CONTENT into Startup or `C:\Pause` — only move `.lnk`s.
- Expected impact of a stopped terminal: bridge retries with backoff, live
  key expires after 60 s, dashboard shows stale data for that account. That
  is normal, not an incident.
