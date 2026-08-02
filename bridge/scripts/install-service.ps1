# Idempotent nssm install/repair for the `bridge` Windows service.
# Run ON THE HOST (forexvps), as Administrator: C:\analytic> powershell -NoProfile -File bridge\scripts\install-service.ps1
#
# Safe to re-run any time (fresh install, or repair a stale/pending-deletion
# service entry) -- every nssm set below is unconditional and overwrites
# whatever was there. Reads REDIS_URL from bridge\.env on this host and
# never echoes it; if you need to confirm it was applied, use
# `nssm get bridge AppEnvironmentExtra` directly on the host, not through
# a logged/relayed command.

$ErrorActionPreference = "Stop"

$AppDir = "C:\analytic"
$Python = "C:\Python314\python.exe"
$EnvFile = Join-Path $AppDir "bridge\.env"
$LogDir = Join-Path $AppDir "bridge\logs"
$StateDir = Join-Path $AppDir "bridge\state"
$ServiceAccount = ".\supachai"

if (-not (Test-Path $EnvFile)) {
    throw "bridge\.env not found at $EnvFile -- copy bridge\.env.example and fill in REDIS_URL first."
}

$redisLine = Get-Content $EnvFile |
    Where-Object { $_ -match '^\s*REDIS_URL\s*=' } |
    Select-Object -First 1

if (-not $redisLine) {
    throw "REDIS_URL not found in $EnvFile"
}

$redisUrl = (($redisLine -split '=', 2)[1]).Trim()

if ([string]::IsNullOrWhiteSpace($redisUrl)) {
    throw "REDIS_URL is empty in $EnvFile"
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

$exists = (Get-Service -Name bridge -ErrorAction SilentlyContinue) -ne $null
if (-not $exists) {
    Write-Output "Installing new 'bridge' service..."
    & nssm install bridge $Python "-m bridge"
} else {
    Write-Output "'bridge' service already registered -- repairing config in place."
}

& nssm set bridge AppDirectory $AppDir
& nssm set bridge AppParameters "-m bridge"
& nssm set bridge ObjectName $ServiceAccount
& nssm set bridge Start SERVICE_AUTO_START

& nssm set bridge AppStdout (Join-Path $LogDir "bridge-stdout.log")
& nssm set bridge AppStderr (Join-Path $LogDir "bridge-stderr.log")
& nssm set bridge AppRotateFiles 1
& nssm set bridge AppRotateOnline 1
& nssm set bridge AppRotateBytes 10485760

& nssm set bridge AppExit Default Restart
& nssm set bridge AppRestartDelay 5000
& nssm set bridge AppStopMethodConsole 25000

# BRIDGE_STATE_DIR (Python-resolved) and BRIDGE_STATE_DIR_WINDOWS (baked
# into each generated per-account config) must point at the same physical
# directory -- see bridge/.env.example and docs/harness ssh-vps skill.
& nssm set bridge AppEnvironmentExtra "REDIS_URL=$redisUrl" "BRIDGE_STATE_DIR=$StateDir" "BRIDGE_STATE_DIR_WINDOWS=$StateDir"

Write-Output "Config applied. Current status:"
& nssm status bridge

Write-Output ""
Write-Output "Not started automatically -- review config above, then run:"
Write-Output "  nssm start bridge"

