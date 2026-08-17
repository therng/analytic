WHEN: "full restart forexvps", "restart everything on the VPS", terminals drifted out of sync.

The box now runs MT5 + 6 services. Preferred full-restart = **reboot Windows** (SCM brings services back in dependency order — data tier first; see analytic-services.md "Boot/dependency order") and then verify per post-reboot-recovery.md. Use the manual sequence below only when a reboot is not wanted:

**SSH command patterns:** See command-execution-strategy.md (inline PowerShell block below is Tier 2 style — can be saved as `.ps1` file and executed via `-File`).

DO (single `-Command` block, or save as `.ps1` and run via `-File`) — ORDER MATTERS, data tier up before its consumers, bridge last (it should only start publishing once Redis has consumers ready):
```powershell
nssm stop bridge
# data tier
nssm restart redis-wsl
Restart-Service postgresql-x64-16
# consumers of the data tier
nssm restart analytic-worker
nssm restart analytic-web
nssm restart caddy
# terminals
$startupDirs = @("C:\Users\supachai\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup")
foreach ($startup in $startupDirs) {
    if (!(Test-Path $startup)) { continue }
    Get-ChildItem $startup -Filter *.lnk | Sort-Object Name | ForEach-Object {
        Start-Process $_.FullName
        Start-Sleep -Seconds 3
    }
}
# producer last
nssm restart bridge
```
NOTES:
- `nssm restart <svc>` on a not-yet-installed stack service errors "no such service" — during the migration window, skip that line (see analytic-services.md).
- Launches every Startup `.lnk` unconditionally. Paused (`C:\Pause`) correctly skipped. Temp-closed terminals WILL come back — confirm with user first if unwanted.
- Wait ~30s between postgres/redis restart and worker/web restarts so the data tier is accepting connections (worker exits 1 if Redis is down at boot; NSSM will retry, but avoid the churn).

VERIFY after: `Get-Service postgresql-x64-16,redis-wsl,analytic-worker,analytic-web,caddy | Format-Table Name,Status` (all Running) + `Get-Process terminal64` + `nssm status bridge` + worker health `:9200/health` → 200 (analytic-services.md) + `curl -sI https://therng.duckdns.org/` from your machine → 200. Health JSONs if anything looks off (status-check.md step 5).
