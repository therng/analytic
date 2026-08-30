# 5-minute worker-health probe; appends one line to health-probe.log on failure only.
# Also detects the silent-WSL-distro-loss failure mode (redis relay gone).
$r = try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9200/health -TimeoutSec 10 } catch { $null }
$redis = Test-NetConnection 127.0.0.1 -Port 6379 -WarningAction SilentlyContinue
if ($null -eq $r -or $r.StatusCode -ne 200) {
  Add-Content C:\analytic\logs\health-probe.log ("{0} worker health FAIL" -f (Get-Date -Format o))
}
elseif (-not $redis.TcpTestSucceeded) {
  Add-Content C:\analytic\logs\health-probe.log ("{0} redis 6379 unreachable (WSL distro down?)" -f (Get-Date -Format o))
}
