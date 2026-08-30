# Scheduled-task launcher for the MT5 bridge (runs as supachai at logon —
# the identity that owns the MT5 terminal sessions; LocalSystem hangs at
# session-0 MT5 attach). Reads bridge\.env in-process; never echoes values.
# python -u under cmd redirection => unbuffered logs in bridge-task.log.
$ErrorActionPreference = 'Stop'
Add-Content -Path 'C:\analytic\bridge\logs\bridge-task.log' -Value ("=== wrapper start " + (Get-Date -Format o) + " ===")
Get-Content 'C:\analytic\bridge\.env' | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), 'Process')
  }
}
if (-not [Environment]::GetEnvironmentVariable('REDIS_URL', 'Process')) {
  Add-Content -Path 'C:\analytic\bridge\logs\bridge-task.log' -Value 'REDIS_URL failed to load from bridge\.env - aborting'
  exit 1
}
Set-Location 'C:\analytic'
cmd /c "C:\Python314\python.exe -u -m bridge >> C:\analytic\bridge\logs\bridge-task.log 2>&1"
Add-Content -Path 'C:\analytic\bridge\logs\bridge-task.log' -Value ("=== wrapper exit " + (Get-Date -Format o) + " code=" + $LASTEXITCODE + " ===")
