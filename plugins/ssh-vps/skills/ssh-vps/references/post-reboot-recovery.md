WHEN: "check terminals after reboot/update", suspected Windows restart. SIGNAL: fewer running terminals than Startup shortcuts.

DO:
1. `ssh forexvps 'powershell -NoProfile -Command "dir \"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\""'` — expected set.
2. `ssh forexvps 'powershell -NoProfile -Command "Get-Process terminal64 | Select-Object Id, ProcessName, Path"'` — actual set.
3. Any shortcut with no matching running process → `ssh forexvps 'powershell -NoProfile -Command "Start-Process \"$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\<Name>.lnk\""'`
4. `ssh forexvps 'nssm status bridge'` — not running → `ssh forexvps 'nssm restart bridge'`
