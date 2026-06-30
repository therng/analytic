# MT5 Bridge

Connects to MetaTrader 5 terminals on Windows VPS and streams live account data to Redis every 2 seconds.

## How it works

```
MT5 Terminal(s)
      │  MetaTrader5 Python API
      ▼
mt5_bridge.py  ──────────────────────────────────────────┐
(one process per account)                                  │
  • polls account_info() every 2s                         │  Redis keys
  • polls positions_get() every 2s                        │
  • writes to Redis:                                       │
      mt5:account:{login}:live       (Hash, no TTL)       │
      mt5:account:{login}:positions  (JSON string, TTL 10s)│
                                                           │
run_all.py  ◄──── discovers terminals ◄── discover_terminals.py
  • spawns one mt5_bridge.py per terminal
  • auto-restarts crashed processes
```

## Files

| File | Purpose |
|------|---------|
| `mt5_bridge.py` | Core bridge — connects to one terminal, polls and pushes to Redis |
| `run_all.py` | Supervisor — discovers all portable terminals, spawns + watches bridge processes |
| `discover_terminals.py` | Finds MT5 terminal paths from Windows Startup folder `.lnk` shortcuts |
| `requirements.txt` | Python dependencies |
| `spike/test_dual_connect.py` | Verify two terminals can connect simultaneously before production |

## Redis schema

### `mt5:account:{login}:live` — Hash (no TTL)

Holds account financials, updated every poll cycle.

| Field | Source | Description |
|-------|--------|-------------|
| `login` | `account_info().login` | MT5 account number |
| `balance` | `account_info().balance` | Account balance |
| `equity` | `account_info().equity` | Equity (balance + floating P/L) |
| `margin` | `account_info().margin` | Used margin |
| `freeMargin` | `account_info().margin_free` | Free margin |
| `marginLevel` | `account_info().margin_level` | Margin level % |
| `profit` | `account_info().profit` | Total floating P/L |
| `credit` | `account_info().credit` | Credit facility |
| `currency` | `account_info().currency` | Account currency |

### `mt5:account:{login}:positions` — JSON string (TTL 10s)

Array of open positions. Key expires 10s after last write — absence means bridge is offline (stale).

```json
[
  {
    "ticket": 123456,
    "symbol": "XAUUSD",
    "type": 0,
    "volume": 0.10,
    "openPrice": 3320.50,
    "currentPrice": 3325.00,
    "sl": 3310.00,
    "tp": 3350.00,
    "profit": 45.00,
    "swap": -1.20,
    "comment": "Bot_Grid",
    "openTime": 1719700000
  }
]
```

`type`: `0` = Buy, `1` = Sell  
`sl` / `tp`: `0` means not set  
`openTime`: Unix timestamp in seconds

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

Requires Windows — `MetaTrader5`, `winshell`, and `pywin32` are Windows-only.

### 2. Configure Redis URL

Create `bridge/.env`:

```env
REDIS_URL=redis://:yourpassword@127.0.0.1:6379
```

### 3. Connect forexvps to Redis via SSH tunnel

Run this on forexvps and keep it alive (Task Scheduler or nssm):

```bash
ssh -N -L 6379:localhost:6379 user@central-server
```

Test: `redis-cli -p 6379 -a yourpassword ping`

### 4. Verify terminal discovery

```bash
python discover_terminals.py
```

Each MT5 terminal shortcut in `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` must have `/portable` in its arguments. The path is resolved from the `APPDATA` environment variable automatically, so it works on any Windows user account.

### 5. Spike test (recommended before production)

```bash
python spike/test_dual_connect.py "C:\MT5_1\terminal64.exe" "C:\MT5_2\terminal64.exe"
```

Confirms multi-terminal connection works and each returns a distinct login.

### 6. Run

```bash
python run_all.py
```

Processes auto-restart if they crash.

## Production (Windows Service)

Install [nssm](https://nssm.cc/):

```bash
nssm install MT5Bridge "C:\Python\python.exe" "C:\bridge\run_all.py"
nssm set MT5Bridge AppEnvironmentExtra REDIS_URL=redis://:9717@therng.duckdns.org:6379
nssm set MT5Bridge AppDirectory C:\bridge
nssm start MT5Bridge
```

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| `mt5.initialize failed` | Terminal not running, or wrong path |
| `account_info()` returns `None` | Terminal open but not logged in |
| Redis connection refused | SSH tunnel down, or wrong `REDIS_URL` |
| Dashboard shows stale data | Bridge stopped; `positions` key expired (TTL 10s) |
| No terminals discovered | Shortcuts missing `/portable` flag or not in Startup folder |
