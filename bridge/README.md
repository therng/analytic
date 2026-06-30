# MT5 Python Bridge

Reads live account info + open positions from MetaTrader 5 terminals and pushes to Redis every 2 seconds.

## Setup (on forexvps Windows)

```bash
pip install -r requirements.txt
```

## Prerequisites

**Redis must be reachable from forexvps.** Use an SSH tunnel:

```bash
# Run this on forexvps (keep it alive with nssm or Task Scheduler)
ssh -N -L 6379:localhost:6379 user@central-server
```

Or use a VPN so forexvps can reach the central server's Redis port directly.

Redis must have AUTH enabled (`requirepass` in redis.conf).

## Step 0: Spike Test

Before running all bridges, verify multi-terminal connection works:

```bash
python spike/test_dual_connect.py "C:\MT5_1\terminal64.exe" "C:\MT5_2\terminal64.exe"
```

Expected output: two distinct login numbers. If either is `None`, switch to sequential mode (contact developer).

## Running

```bash
# Set Redis URL (include password)
set REDIS_URL=redis://:yourpassword@127.0.0.1:6379

# Check which terminals were discovered
python discover_terminals.py

# Run all bridges
python run_all.py
```

Processes restart automatically if they crash.

## Windows Service (recommended for production)

Install [nssm](https://nssm.cc/):

```bash
nssm install MT5Bridge "C:\Python\python.exe" "C:\bridge\run_all.py"
nssm set MT5Bridge AppEnvironmentExtra REDIS_URL=redis://:password@127.0.0.1:6379
nssm set MT5Bridge AppDirectory C:\bridge
nssm start MT5Bridge
```

## Redis Keys

| Key | Type | TTL | Content |
|-----|------|-----|---------|
| `mt5:account:{login}:live` | Hash | none | balance, equity, margin, freeMargin, marginLevel, profit, currency |
| `mt5:account:{login}:positions` | String (JSON) | 10s | open positions array |

If `positions` key is missing (TTL expired), the account is considered stale.

## Troubleshooting

- `mt5.initialize` fails → terminal not running, or wrong path
- Redis connection refused → SSH tunnel not up, or wrong REDIS_URL
- Login is `None` → terminal running but not logged in (check MT5 UI)
