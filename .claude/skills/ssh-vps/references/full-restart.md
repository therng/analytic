WHEN: "full restart forexvps", "restart everything on the VPS", terminals drifted out of sync.

**SSH command patterns:** See command-execution-strategy.md (inline PowerShell block below is Tier 2 style — can be saved as `.ps1` file and executed via `-File`).

DO (single `-Command` block, or save as `.ps1` and run via `-File`):
```powershell
nssm stop bridge
$startupDirs = @("C:\Users\supachai\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup")
foreach ($startup in $startupDirs) {
    if (!(Test-Path $startup)) { continue }
    Get-ChildItem $startup -Filter *.lnk | Sort-Object Name | ForEach-Object {
        Start-Process $_.FullName
        Start-Sleep -Seconds 3
    }
}
nssm restart bridge
```

NOTE: launches every Startup `.lnk` unconditionally. Paused (`C:\Pause`) correctly skipped. Temp-closed terminals WILL come back — confirm with user first if unwanted.

VERIFY after: `ssh forexvps 'powershell -NoProfile -Command "Get-Process terminal64 | Select-Object Id, ProcessName, Path"'` + `ssh forexvps 'nssm status bridge'`; health check (status-check.md step 5) if anything looks off.
