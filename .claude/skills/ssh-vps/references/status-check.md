WHEN: "check MT5 status", "is bridge up", "เช็ค MT5".

DO:
1. `ssh forexvps 'powershell -NoProfile -Command "Get-Process terminal64 | Select-Object Id, ProcessName, Path"'`
   No process → error "Cannot find a process with the name terminal64" = 0 running, not a failure.
2. `ssh forexvps 'powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; Get-ChildItem \"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\" -Filter *.lnk | ForEach-Object { $sc = $ws.CreateShortcut($_.FullName); [PSCustomObject]@{ Name=$_.BaseName; TargetPath=$sc.TargetPath; Arguments=$sc.Arguments } }"'`
   Match `TargetPath`/`Path` against step 1 → named terminal (e.g. "Boat") up/down.
   Authoritative alt (Python, no friendly names): `ssh forexvps 'cd C:\analytic; & "C:\Python314\python.exe" -m bridge_v2.terminal_discovery'`
3. `ssh forexvps 'nssm status MT5BridgeV2'` (fallback: `sc query MT5BridgeV2`)
4. `ssh forexvps 'powershell -NoProfile -Command "if (Test-Path C:\Pause) { dir C:\Pause } else { Write-Output \"C:\Pause does not exist yet\" }"'`
5. OPTIONAL heartbeat (most authoritative liveness) — use connection.md `-EncodedCommand` pattern with:
   ```python
   import os, redis
   from dotenv import load_dotenv
   load_dotenv(r"bridge\.env")
   r = redis.from_url(os.environ["REDIS_URL"], decode_responses=True)
   print(sorted(r.keys("mt5:v2:bridge:*:heartbeat")))
   ```
   Key = `mt5:v2:bridge:{login}:heartbeat`. Old `mt5:bridge:heartbeat:*` (no v2) is stale, ignore.
   No heartbeat + process running = stuck (targeted restart worth it). No heartbeat + no process = down.

OUTPUT: name each terminal up/down/paused, not a bare count. e.g. "forexvps: Boat, Eak up. Airisa2 down. Jade paused."

FAIL: account in `C:\Pause` (step 4) = "paused", never "down/missing".
