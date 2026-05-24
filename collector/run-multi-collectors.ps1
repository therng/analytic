# Script to run 10 MT5 Collector instances
# Each instance points to a different MT5 terminal (C:\MT1 to C:\MT10)

$CollectorPath = "C:\collector\dist\mt5-collector.exe"
$BaseMT5Path = "C:\MT"
$InstancesCount = 10

for ($i = 1; $i -le $InstancesCount; $i++) {
    $MTPath = "$BaseMT5Path$i\terminal64.exe"
    $RunDir = "C:\collector\run$i"
    
    # Create run directory if it doesn't exist
    if (-not (Test-Path $RunDir)) {
        New-Item -ItemType Directory -Path $RunDir | Out-Null
    }
    
    # Create .env for this instance
    $EnvContent = @"
GATEWAY_URL=http://localhost:8000/api/v1/ingest
API_SECRET=therng
POLL_INTERVAL=1
MT5_PATH=$MTPath
"@
    $EnvContent | Out-File -FilePath "$RunDir\.env" -Encoding ASCII
    
    Write-Host "Starting Collector $i for MT5 at $MTPath..." -ForegroundColor Cyan
    
    # Start the collector in a new window
    Start-Process -FilePath $CollectorPath -WorkingDirectory $RunDir -ArgumentList "--name", "mt5-collector-$i"
}

Write-Host "All $InstancesCount collectors have been triggered." -ForegroundColor Green
