# Idempotent nssm install/repair for the `bridge` Windows service.
# Windows Server 2022. Assumes nssm.exe on PATH, Python 3.14 at
# C:\Python314\python.exe, repo already deployed to C:\analytic, and the
# .\supachai local account already created. Run ON THE HOST, as
# Administrator: C:\analytic> powershell -NoProfile -File bridge\scripts\install-service.ps1
#
# Safe to re-run any time (fresh install, or repair a stale/pending-deletion
# service entry) -- every nssm set below is unconditional and overwrites
# whatever was there. Prompts for the .\supachai account password each run
# (nssm needs it to grant "Log on as a service" and start the process) --
# pass -ServicePassword (SecureString) to script non-interactively. Reads
# REDIS_URL from bridge\.env on this host and never echoes it; if you need
# to confirm it was applied, use `nssm get bridge AppEnvironmentExtra`
# directly on the host, not through a logged/relayed command.

param(
    [securestring]$ServicePassword
)

$ErrorActionPreference = "Stop"

$AppDir = "C:\analytic"
$Python = "C:\Python314\python.exe"
$EnvFile = Join-Path $AppDir "bridge\.env"
$LogDir = Join-Path $AppDir "bridge\logs"
$StateDir = Join-Path $AppDir "bridge\state"
$ServiceAccount = "analyticvps\supachai"

if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) {
    throw "nssm.exe not found on PATH -- install nssm first."
}

if (-not (Test-Path $Python)) {
    throw "Python not found at $Python -- install Python 3.14 there first."
}

if (-not (Test-Path $AppDir)) {
    throw "$AppDir not found -- clone/deploy the repo there first."
}

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

# journal/connection.py's _validate_windows_acl requires the journal dir's
# DACL to be protected (inheritance broken) and every ACE restricted to the
# service account SID only -- an inherited ACL (SYSTEM/Administrators/Users
# from C:\analytic) always fails that check and the account quarantines
# with "journal parent must be a real directory" / "journal path must be
# restricted to the service identity", even though the directory is real
# and readable. Re-applied every run since a fresh journal dir (new host,
# reset-history, deleted state) reinherits the parent ACL by default.
$JournalDir = Join-Path $StateDir "journal"
New-Item -ItemType Directory -Force -Path $JournalDir | Out-Null
$serviceAccountName = $ServiceAccount.TrimStart('.', '\')
& icacls $JournalDir /inheritance:r /grant:r "${serviceAccountName}:(OI)(CI)F" | Out-Null
& icacls $JournalDir /setowner $serviceAccountName | Out-Null

$exists = (Get-Service -Name bridge -ErrorAction SilentlyContinue) -ne $null
if (-not $exists) {
    Write-Output "Installing new 'bridge' service..."
    & nssm install bridge $Python "-m bridge"
} else {
    Write-Output "'bridge' service already registered -- repairing config in place."
}

if (-not $ServicePassword) {
    $ServicePassword = Read-Host -Prompt "Password for $ServiceAccount" -AsSecureString
}
$plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ServicePassword))

& nssm set bridge AppDirectory $AppDir
& nssm set bridge AppParameters "-m bridge"
& nssm set bridge ObjectName $ServiceAccount $plainPassword
& nssm set bridge Start SERVICE_AUTO_START
$plainPassword = $null

& nssm set bridge AppStdout (Join-Path $LogDir "bridge-stdout.log")
& nssm set bridge AppStderr (Join-Path $LogDir "bridge-stderr.log")
& nssm set bridge AppRotateFiles 1
& nssm set bridge AppRotateOnline 1
& nssm set bridge AppRotateBytes 10485760

& nssm set bridge AppExit Default Restart
& nssm set bridge AppRestartDelay 5000
& nssm set bridge AppThrottle 1500
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

