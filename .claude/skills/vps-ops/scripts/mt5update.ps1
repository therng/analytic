# mt5update.ps1 - MT5 liveupdate maintenance for the forexvps single host.
#
# Why this exists: on this host the MetaQuotes liveupdate stage-and-swap of
# terminal64.exe never completes (downloads fine, swap never lands). Terminals
# fall back to relaunching the OLD binary with /skipupdate:<md5>, which only
# lasts for that process run - so every logon replays the whole dance
# (2-6 min downtime per terminal) and occasionally an /update copier hangs
# with no fallback, leaving that account silently dead (2026-09-06/07).
#
# What it does: when a new build is staged under
# %APPDATA%\MetaQuotes\Terminal\<hash>\liveupdate\mt5clw64.<build>, apply it
# deterministically ourselves - kill every terminal64.exe (enumerated PIDs,
# never /IM), extract the single terminal64.exe entry from the staged ZIP
# payload, verify the Authenticode signature (MetaQuotes) and the file
# version, back up and replace each Startup-folder terminal, then optionally
# reboot the machine (watch mode) so the whole stack comes back clean.
#
# Repo vps-ops skill is the source of truth. Log: C:\analytic\logs\mt5update\.
# Exit codes: 0 = ok / nothing to do, 1 = failure (check log), 2 = missing -Confirm.

param(
    [ValidateSet('Detect', 'Apply', 'Watch')]
    [string]$Mode = 'Detect',
    [switch]$Confirm,
    [switch]$Reboot,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

$StartupDir    = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
$TerminalsRoot = Join-Path $env:APPDATA 'MetaQuotes\Terminal'
$LogDir        = 'C:\analytic\logs\mt5update'
$LogFile       = Join-Path $LogDir 'mt5update.log'
$FailMarker    = Join-Path $LogDir 'FAILED'
$PythonExe     = 'C:\Python314\python.exe'
$Mt5opsPy      = 'C:\analytic\.claude\skills\vps-ops\scripts\mt5ops.py'

function Write-Log {
    param([string]$Message)
    $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    # Write-Host, NOT Write-Output: pipeline output here would pollute the
    # return values of functions that call Write-Log (Get-VerifiedPayload
    # returned [logline, path] once and Copy-Item read the timestamp as a
    # drive name). Add-Content is the real sink.
    if (-not $Quiet) { Write-Host $line }
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# Run a native command without letting its stderr become a terminating
# ErrorRecord (PS 5.1 + $ErrorActionPreference='Stop' trap: taskkill writes
# "ERROR: ... could not be terminated" to stderr for windowless processes,
# and a 2>$null redirect still wraps it). We log outcomes ourselves instead.
function Invoke-Native {
    param([string]$File, [string[]]$Arguments)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $File @Arguments 2>$null | Out-Null } catch { } finally { $ErrorActionPreference = $prev }
}

# Startup .lnk shortcuts whose target is a terminal64.exe = the managed fleet.
function Get-Fleet {
    $sh = New-Object -ComObject WScript.Shell
    $fleet = @()
    foreach ($lnk in (Get-ChildItem $StartupDir -Filter '*.lnk' -ErrorAction SilentlyContinue)) {
        $target = $sh.CreateShortcut($lnk.FullName).TargetPath
        if ($target -and ((Split-Path $target -Leaf) -ieq 'terminal64.exe') -and (Test-Path $target)) {
            $fleet += [pscustomobject]@{
                Lnk        = $lnk.FullName
                Name       = $lnk.BaseName
                Exe        = $target
                InstallDir = Split-Path $target -Parent
                Build      = Get-Build $target
            }
        }
    }
    return $fleet
}

function Get-Build {
    param([string]$ExePath)
    $fv = (Get-Item $ExePath).VersionInfo.FileVersion
    if ($fv -match '(\d+)\s*$') { return [int]$Matches[1] }
    return 0
}

# All staged liveupdate payloads across every MetaQuotes terminal hash dir.
function Get-StagedPayloads {
    $payloads = @()
    $dirs = Get-ChildItem $TerminalsRoot -Directory -ErrorAction SilentlyContinue
    foreach ($d in $dirs) {
        $lu = Get-ChildItem (Join-Path $d.FullName 'liveupdate') -Filter 'mt5clw64.*' -File -ErrorAction SilentlyContinue
        foreach ($f in $lu) {
            if ($f.Name -match '^mt5clw64\.(\d{4,5})$') {
                $payloads += [pscustomobject]@{ Build = [int]$Matches[1]; Path = $f.FullName; Length = $f.Length }
            }
        }
    }
    return $payloads
}

function Get-Terminal64Processes {
    $procs = @()
    foreach ($p in (Get-CimInstance Win32_Process -Filter "Name='terminal64.exe'" -ErrorAction SilentlyContinue)) {
        $kind = 'install'
        if ($p.CommandLine -match '/update') { $kind = 'updater' }
        elseif ($p.ExecutablePath -notmatch '^C:\\MT\d+\\terminal64\.exe$') { $kind = 'staging' }
        $procs += [pscustomobject]@{ Pid = $p.ProcessId; Kind = $kind; Path = $p.ExecutablePath; Cmd = $p.CommandLine; Started = $p.CreationDate }
    }
    return $procs
}

# Delete stale liveupdate staging CONTENTS (never the hash-dir root files:
# origin.txt/portable.txt/config\ carry the hash<->install mapping). Stale
# components here make even a fully up-to-date terminal re-run the update
# dance at every cold start, and MT9's /update copier hangs forever on them
# (2026-09-07, twice). Only safe when nothing staged is newer than the
# lowest installed build - i.e. no rollout is mid-flight (a partial fresh
# download shows up as a higher-build payload and blocks the purge itself).
function Invoke-StagingPurge {
    param([object[]]$Fleet, [object[]]$Payloads)
    $minInstalled = ($Fleet | Measure-Object -Property Build -Minimum).Minimum
    $pending = @($Payloads | Where-Object { $_.Build -gt $minInstalled })
    if ($pending) {
        Write-Log ("staging purge skipped: rollout pending (payload {0} > installed {1})" -f $pending[0].Build, $minInstalled)
        return
    }
    $purged = 0
    foreach ($d in (Get-ChildItem $TerminalsRoot -Directory -ErrorAction SilentlyContinue)) {
        $lu = Join-Path $d.FullName 'liveupdate'
        if (-not (Test-Path $lu)) { continue }
        $files = @(Get-ChildItem $lu -Recurse -File -ErrorAction SilentlyContinue)
        if (-not $files.Count) { continue }
        $files | Remove-Item -Force -ErrorAction SilentlyContinue
        Get-ChildItem $lu -Directory -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
        $purged += $files.Count
    }
    if ($purged -gt 0) { Write-Log "staging purge: removed $purged stale file(s) (fleet up-to-date)" }
}

# A hung /update copier leaves its terminal dead forever - the ~3-min
# fallback relaunch never fires (MT9, 45-50 min hangs on 2026-09-07). Kill
# updaters older than 15 min by PID and bring their /path terminal back
# via its Startup .lnk. Watch mode only.
function Invoke-StaleUpdaterHeal {
    param([object[]]$Fleet)
    foreach ($p in (Get-Terminal64Processes)) {
        if ($p.Kind -ne 'updater') { continue }
        $age = (Get-Date) - [datetime]$p.Started
        if ($age.TotalMinutes -lt 15) { continue }
        Write-Log ("stale updater: pid={0} age={1:N0} min - killing" -f $p.Pid, $age.TotalMinutes)
        Invoke-Native taskkill @('/F', '/PID', "$($p.Pid)")
        $path = if ($p.Cmd -match '/path:"([^"]+)"') { $Matches[1] } else { $null }
        $target = $Fleet | Where-Object { $_.InstallDir -ieq $path }
        $stillRunning = @(Get-Terminal64Processes | Where-Object { $_.Path -ieq $target.Exe })
        if ($target -and -not $stillRunning.Count) {
            Write-Log ("restarting {0} ({1})" -f $target.Name, $target.InstallDir)
            Start-Process -FilePath $target.Lnk
        }
    }
}

function Invoke-StatusSnapshot {
    if (-not (Test-Path $Mt5opsPy)) { Write-Log 'snapshot: mt5ops.py not found (skipped)'; return }
    try {
        $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $out = & $PythonExe $Mt5opsPy status | Out-String
        $ErrorActionPreference = $prev
        foreach ($line in ($out -split "`r?`n")) {
            if ($line -match '^\s*\d+\s') { Write-Log "pre-kill: $line" }
        }
    } catch { Write-Log "snapshot: unavailable ($($_.Exception.Message))" }
}

# Graceful close first (WM_CLOSE lets MT5 save state), force-kill the rest.
function Stop-AllTerminals {
    $procs = Get-Terminal64Processes
    if (-not $procs) { Write-Log 'no terminal64.exe processes running'; return $true }
    foreach ($p in $procs) {
        Write-Log ("close pid={0} kind={1} path={2}" -f $p.Pid, $p.Kind, $p.Path)
        Invoke-Native taskkill @('/PID', "$($p.Pid)")
    }
    Start-Sleep -Seconds 20
    foreach ($p in (Get-Terminal64Processes)) {
        Write-Log ("force pid={0} kind={1}" -f $p.Pid, $p.Kind)
        Invoke-Native taskkill @('/F', '/PID', "$($p.Pid)")
    }
    Start-Sleep -Seconds 3
    $left = Get-Terminal64Processes
    if ($left) {
        foreach ($p in $left) { Write-Log ("STILL ALIVE pid={0} path={1}" -f $p.Pid, $p.Path) }
        return $false
    }
    return $true
}

function Start-AllTerminals {
    param([object[]]$Fleet)
    foreach ($t in $Fleet) {
        Write-Log ("start {0} ({1})" -f $t.Name, $t.InstallDir)
        Start-Process -FilePath $t.Lnk
        Start-Sleep -Seconds 5
    }
}

# Extract the single terminal64.exe entry from the payload ZIP and verify it:
# Authenticode signature must be Valid and signed by MetaQuotes, and the file
# version must equal the target build. Returns the verified temp exe path.
function Get-VerifiedPayload {
    param([string]$PayloadPath, [int]$TargetBuild)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $tempDir = Join-Path $env:TEMP ("mt5update-{0}" -f $TargetBuild)
    if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
    New-Item -ItemType Directory -Force $tempDir | Out-Null
    $tempExe = Join-Path $tempDir 'terminal64.exe'
    $zip = [System.IO.Compression.ZipFile]::OpenRead($PayloadPath)
    try {
        $entry = $zip.Entries | Where-Object { $_.Name -ieq 'terminal64.exe' } | Select-Object -First 1
        if (-not $entry) { Write-Log "payload gate FAIL: no terminal64.exe entry in $PayloadPath"; return $null }
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $tempExe, $true)
    }
    finally { $zip.Dispose() }
    $sig = Get-AuthenticodeSignature -FilePath $tempExe
    if ($sig.Status -ne 'Valid') { Write-Log ("payload gate FAIL: signature {0}" -f $sig.Status); return $null }
    if ($sig.SignerCertificate.Subject -notmatch 'MetaQuotes') {
        Write-Log ("payload gate FAIL: signer is not MetaQuotes ({0})" -f $sig.SignerCertificate.Subject); return $null
    }
    $build = Get-Build $tempExe
    if ($build -ne $TargetBuild) { Write-Log ("payload gate FAIL: version {0} != target {1}" -f $build, $TargetBuild); return $null }
    Write-Log ("payload verified: build {0}, signer {1}" -f $build, ($sig.SignerCertificate.Subject -replace ',.*$', ''))
    return $tempExe
}

function Invoke-Apply {
    param([object[]]$Fleet, [object]$TargetPayload)

    $target = $TargetPayload.Build
    $behind = @($Fleet | Where-Object { $_.Build -lt $target })
    if (-not $behind) { Write-Log "UP-TO-DATE (target $target already installed everywhere)"; return 0 }

    Write-Log ("APPLY start: target build {0} from {1}; behind: {2}" -f $target, $TargetPayload.Path, (($behind | ForEach-Object { '{0}({1})' -f $_.Name, $_.Build }) -join ', '))

    $verifiedExe = Get-VerifiedPayload -PayloadPath $TargetPayload.Path -TargetBuild $target
    if (-not $verifiedExe) {
        Write-Log 'ABORT before any changes: payload failed verification'
        New-Item -ItemType Directory -Force $LogDir | Out-Null
        Set-Content -Path $FailMarker -Value ("payload verification failed {0}" -f (Get-Date)) -Encoding UTF8
        return 1
    }

    Invoke-StatusSnapshot

    if (-not (Stop-AllTerminals)) {
        Write-Log 'ABORT: could not stop all terminal64.exe processes; restarting terminals, no files changed'
        Start-AllTerminals -Fleet $Fleet
        Set-Content -Path $FailMarker -Value ("kill phase failed {0}" -f (Get-Date)) -Encoding UTF8
        return 1
    }

    $backups = @{}
    $failed = $false
    foreach ($t in $behind) {
        try {
            $bak = '{0}.bak-{1}' -f $t.Exe, $t.Build
            Copy-Item $t.Exe $bak -Force
            $backups[$t.Exe] = $bak
            Copy-Item $verifiedExe $t.Exe -Force
            $newBuild = Get-Build $t.Exe
            if ($newBuild -ne $target) { throw "post-copy version is $newBuild, expected $target" }
            Write-Log ("replaced {0}: build {1} -> {2} (backup {3})" -f $t.InstallDir, $t.Build, $newBuild, $bak)
        } catch {
            Write-Log ("FAILED on {0}: {1}" -f $t.InstallDir, $_.Exception.Message)
            $failed = $true
            break
        }
    }

    if ($failed) {
        Write-Log 'ROLLBACK: restoring all backups'
        foreach ($exe in $backups.Keys) {
            try { Copy-Item $backups[$exe] $exe -Force; Write-Log "restored $exe" }
            catch { Write-Log ("ROLLBACK ERROR on {0}: {1}" -f $exe, $_.Exception.Message) }
        }
        Start-AllTerminals -Fleet $Fleet
        Set-Content -Path $FailMarker -Value ("apply failed, rolled back {0}" -f (Get-Date)) -Encoding UTF8
        Write-Log 'APPLY FAILED - rolled back, terminals restarted, NO reboot'
        return 1
    }

    $stillBehind = @($Fleet | Where-Object { (Get-Build $_.Exe) -lt $target })
    if ($stillBehind) {
        Write-Log ('VERIFY FAIL: still behind: ' + (($stillBehind | ForEach-Object { $_.Name }) -join ', '))
        Start-AllTerminals -Fleet $Fleet
        return 1
    }
    Write-Log ("APPLY OK: every Startup terminal now on build {0}" -f $target)

    Invoke-StagingPurge -Fleet $Fleet -Payloads (Get-StagedPayloads)

    if ($Reboot) {
        Write-Log 'REBOOT requested: shutdown /r /t 30 (terminals will start from Startup after reboot)'
        Invoke-Native shutdown @('/r', '/t', '30')
    } else {
        Start-AllTerminals -Fleet $Fleet
        Write-Log 'terminals restarted via Startup .lnk; reboot recommended but not requested'
    }
    return 0
}

# ---- main ----
New-Item -ItemType Directory -Force $LogDir | Out-Null
Write-Log ("=== mt5update mode={0} confirm={1} reboot={2} ===" -f $Mode, $Confirm.IsPresent, $Reboot.IsPresent)

$fleet = Get-Fleet
if (-not $fleet) { Write-Log 'ERROR: no terminal64.exe .lnk found in Startup folder'; exit 1 }
foreach ($t in $fleet) { Write-Log ("fleet: {0} -> {1} (build {2})" -f $t.Name, $t.Exe, $t.Build) }

$payloads = Get-StagedPayloads
if ($payloads) {
    foreach ($p in $payloads) { Write-Log ("staged: build {0} ({1:N0} bytes) {2}" -f $p.Build, $p.Length, $p.Path) }
} else {
    Write-Log 'staged: none'
}

$target = ($payloads | Measure-Object -Property Build -Maximum).Maximum
if (-not $target) { Write-Log 'UP-TO-DATE (no staged payloads)'; exit 0 }

$behind = @($fleet | Where-Object { $_.Build -lt $target })
if (-not $behind) { Write-Log "UP-TO-DATE (target $target already installed everywhere)"; exit 0 }

$targetPayload = $payloads | Where-Object { $_.Build -eq $target } | Select-Object -First 1
Write-Log ("PENDING build {0}; behind: {1}" -f $target, (($behind | ForEach-Object { '{0}({1})' -f $_.Name, $_.Build }) -join ', '))

foreach ($p in (Get-Terminal64Processes)) {
    Write-Log ("running: pid={0} kind={1} path={2}" -f $p.Pid, $p.Kind, $p.Path)
}

switch ($Mode) {
    'Detect' { Write-Log 'detect-only: no action taken'; exit 0 }
    'Apply' {
        if (-not $Confirm) { Write-Log 'refusing to apply without -Confirm'; exit 2 }
        $rc = Invoke-Apply -Fleet $fleet -TargetPayload $targetPayload
        exit $rc
    }
    'Watch' {
        if (Test-Path $FailMarker) {
            Write-Log "FAIL marker present ($FailMarker) - auto-run suppressed until operator clears it"
            exit 1
        }
        if (-not $Confirm) { Write-Log 'refusing to watch-apply without -Confirm'; exit 2 }
        Invoke-StaleUpdaterHeal -Fleet $fleet
        if (-not $behind) {
            Invoke-StagingPurge -Fleet $fleet -Payloads $payloads
            Write-Log 'watch: up-to-date, no action needed'
            exit 0
        }
        $rc = Invoke-Apply -Fleet $fleet -TargetPayload $targetPayload
        exit $rc
    }
}
