# Daily trading_db dump -> C:\backups (single refreshed file + dated keep-last-7).
# Reads POSTGRES_PASSWORD from C:\analytic\.env in-process; never echoes it.
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path 'C:\backups' | Out-Null
$envLine = (Get-Content 'C:\analytic\.env' | Where-Object { $_ -match '^\s*POSTGRES_PASSWORD\s*=' } | Select-Object -First 1)
if (-not $envLine) { throw 'POSTGRES_PASSWORD missing in C:\analytic\.env' }
$pw = ($envLine -split '=', 2)[1].Trim()
$env:PGPASSWORD = $pw
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
& 'C:\Program Files\PostgreSQL\18\bin\pg_dump.exe' -h 127.0.0.1 -U supachai -d trading_db -Fc -f "C:\backups\trading_db-$stamp.dump"
Copy-Item "C:\backups\trading_db-$stamp.dump" 'C:\backups\trading_db.dump' -Force
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
# keep the 7 newest dated dumps
Get-ChildItem 'C:\backups' -Filter 'trading_db-*.dump' |
  Sort-Object LastWriteTime -Descending | Select-Object -Skip 7 |
  Remove-Item -Force -ErrorAction SilentlyContinue
