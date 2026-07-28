WHEN: "set autolot to X", "turn strategy N off", "edit chart02.chr", EA chart input param change.

PATH: `C:\<TerminalDir>\MQL5\Profiles\Charts\<Category>\chartNN.chr`. Resolve `<TerminalDir>` — never guess:
`ssh forexvps 'powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $sc = $ws.CreateShortcut(\"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\<Name>.lnk\"); $sc.TargetPath"'`

FORMAT: `key=value`, UTF-16LE+BOM, CRLF (`\r\n`). Plain `Get-Content`/`-replace` without `-Encoding Unicode` mangles it.

SAFETY SEQUENCE — do not skip, compress, or reorder:

1. READ FIRST: `Select-String -Path "<path>" -Pattern <keys, comma-separated, no quotes> -Encoding Unicode` — confirm EA `name=` and current `Inp*` values. Never trust a user-stated "current" value unverified — may already equal target (edit becomes no-op).
2. STOP TERMINAL: `taskkill /PID <pid> /F` (matched PID, not all terminals). Open terminal can overwrite the edit on its own save/exit. Consequence: open positions on that EA unmanaged until relaunch; terminal shows down/heartbeat stuck meanwhile — expected, not a separate incident. Don't stop for an edit not requested.
3. BACKUP: `Copy-Item $p "$p.bak_<date>" -Force` before any write. Delete backup once edit verified + terminal confirmed healthy.
4. EDIT — exact, verified pattern:
   ```powershell
   $nl = [System.Environment]::NewLine
   $c  = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::Unicode)
   $n  = $c.Replace("InpAutoLotsValue=3" + $nl, "InpAutoLotsValue=4" + $nl)
   [System.IO.File]::WriteAllText($p, $n, [System.Text.Encoding]::Unicode)
   ```
   FORBIDDEN: `$`-anchored regex (CRLF puts `\r` before `$`, silent no-match). Backtick `` `r`n `` escapes (mangled bash→ssh→PowerShell, silent no-op). Trusting exit code alone — `.Replace()` on no match is a silent no-op with clean exit.
   If unsure: test on `Copy-Item $p "$env:TEMP\t_<name>"` scratch copy first, confirm flip, delete scratch. Don't debug against the live file.
5. VERIFY: re-run step 1's `Select-String`, confirm value changed. Proves the file changed, not that the EA will load it — `chartNN` only takes effect if it's the profile that terminal opens on launch; check if unsure.
6. RELAUNCH: `ssh forexvps 'powershell -NoProfile -Command "Start-Process \"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\<Name>.lnk\""'` — never `terminal64.exe` direct / hand-built `/portable`. Confirm process back (`Get-Process terminal64`) before reporting done.
