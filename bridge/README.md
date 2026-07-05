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
  • auto-reconnects if MT5 drops the connection            │
  • writes to Redis:                                       │
      mt5:account:{login}:live       (Hash, no TTL)       │
      mt5:account:{login}:positions  (JSON string, TTL 10s)│
      mt5:bridge:heartbeat:{login}   (Hash, TTL 10s)       │
                                                           │
run_all.py  ◄──── discovers terminals ◄── discover_terminals.py
  • spawns terminals in small batches with startup jitter
  • per-terminal exponential backoff on restart (1s → 120s)
  • graceful shutdown (CTRL_BREAK_EVENT on Windows) so bridges
    release their Redis lock before exiting
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
| `name` | `account_info().name` | Account owner/display name |
| `server` | `account_info().server` | Broker server name |
| `company` | `account_info().company` | Broker/company name |
| `leverage` | `account_info().leverage` | Account leverage |
| `tradeMode` | `account_info().trade_mode` | Account trade mode |
| `limitOrders` | `account_info().limit_orders` | Maximum pending orders |
| `marginSoMode` | `account_info().margin_so_mode` | Stop-out mode |
| `tradeAllowed` | `account_info().trade_allowed` | Account trading permission |
| `tradeExpert` | `account_info().trade_expert` | Expert advisor trading permission |
| `marginMode` | `account_info().margin_mode` | Account margin calculation mode |
| `currencyDigits` | `account_info().currency_digits` | Currency precision |
| `fifoClose` | `account_info().fifo_close` | FIFO close requirement |
| `balance` | `account_info().balance` | Account balance |
| `equity` | `account_info().equity` | Equity (balance + floating P/L) |
| `margin` | `account_info().margin` | Used margin |
| `freeMargin` | `account_info().margin_free` | Free margin |
| `marginLevel` | `account_info().margin_level` | Margin level % |
| `marginSoCall` | `account_info().margin_so_call` | Margin call level |
| `marginSoSo` | `account_info().margin_so_so` | Stop-out level |
| `marginInitial` | `account_info().margin_initial` | Initial margin |
| `marginMaintenance` | `account_info().margin_maintenance` | Maintenance margin |
| `commissionBlocked` | `account_info().commission_blocked` | Blocked commission |
| `profit` | `account_info().profit` | Total floating P/L |
| `credit` | `account_info().credit` | Credit facility |
| `currency` | `account_info().currency` | Account currency |
| `terminalCommunityAccount` | `terminal_info().community_account` | MQL5 community account configured |
| `terminalCommunityConnection` | `terminal_info().community_connection` | MQL5 community connection status |
| `terminalConnected` | `terminal_info().connected` | Terminal server connection status |
| `terminalTradeAllowed` | `terminal_info().trade_allowed` | Terminal trade permission |
| `terminalTradeapiDisabled` | `terminal_info().tradeapi_disabled` | Terminal trade API disabled flag |
| `terminalFtpEnabled` | `terminal_info().ftp_enabled` | Terminal FTP enabled flag |
| `terminalNotificationsEnabled` | `terminal_info().notifications_enabled` | Terminal notifications enabled flag |
| `terminalBuild` | `terminal_info().build` | Terminal build number |
| `terminalMaxbars` | `terminal_info().maxbars` | Max bars setting |
| `terminalPingLast` | `terminal_info().ping_last` | Last ping in microseconds |
| `terminalName` | `terminal_info().name` | Terminal name |
| `terminalPath` | `terminal_info().path` | Terminal install path |
| `terminalDataPath` | `terminal_info().data_path` | Terminal data path |
| `terminalCommondataPath` | `terminal_info().commondata_path` | Terminal common data path |
| `ordersTotal` | `orders_total()` | Current pending order count |
| `positionsTotal` | `positions_total()` | Current open position count |
| `historyOrdersTotal` | `history_orders_total(...)` | Historical order count for the configured history window |
| `historyDealsTotal` | `history_deals_total(...)` | Historical deal count for the configured history window |
| `historyTotalsUpdatedAt` | bridge timestamp | Unix timestamp when historical totals were refreshed |

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

### `mt5:bridge:heartbeat:{login}` — Hash (TTL 10s)

Liveness signal, independent of `positions`. Absence means the bridge process is dead or stuck (not just "no open positions").

| Field | Description |
|-------|-------------|
| `pid` | Bridge process PID |
| `lastSeen` | Unix timestamp of last successful poll |
| `reconnects` | Count of MT5 reconnects this run |
| `errors` | Count of poll errors this run |

## History sync and live analytics (30s / 2s)

In addition to the 2s live account/position poll, each bridge process:

- Syncs closed-trade history every `HISTORY_SYNC_INTERVAL` (default 30s) via
  `history_deals_get()`/`history_orders_get()`, publishing new records to
  `mt5:account:{login}:deals-stream` / `:orders-stream` (Redis Streams). A
  cursor (`mt5:bridge:history-cursor:{login}`) tracks independent deal and
  order positions so restarts resume instead of rescanning or duplicating one
  stream when the other has not advanced.
- On first run, the history cursor starts at the beginning of Unix time
  (`HISTORY_BACKFILL_DAYS=0`, the default) so the bridge asks MT5 for all
  available terminal history and can seed historical `Deal`, `Order`, and
  closed `Position` rows without FTP. Set `HISTORY_BACKFILL_DAYS` to a positive
  number only when intentionally bounding a backfill.
- Deal payloads include both the worker's existing camelCase fields and the
  report-contract aliases from `docs/words.md` (`deal_id`, `order_id`,
  `position_no`, `direction`, `balance_after`) so blank-type MT5 trade rows
  remain classifiable by `symbol + direction`.
- Tracks running MAE/MFE per open position and running peak-equity/drawdown
  per account (see `tracking.py`), persisted to
  `mt5:account:{login}:position-state` / `:equity-state` every poll so a
  restart doesn't lose mid-life tracking.
- Publishes one enriched event to `mt5:account:{login}:position-closed-stream`
  per closed position (final MAE/MFE, entry/exit price+time, duration).

This is the primary data source for the `Position`/`Deal`/`Order` tables.

## Configuration

All values are optional env vars (set in `bridge/.env` or the process environment).

| Var | Default | Applies to | Purpose |
|-----|---------|-----------|---------|
| `REDIS_URL` | — | both | Redis connection string |
| `POLL_INTERVAL` | `2.0` | bridge | Seconds between polls |
| `LOCK_TTL` | `15` | bridge | Exclusive lock TTL (seconds) |
| `LOCK_REFRESH` | `5` | bridge | How often to renew the lock |
| `POSITIONS_TTL` | `10` | bridge | Positions key TTL |
| `HEARTBEAT_TTL` | `10` | bridge | Heartbeat key TTL |
| `MAX_STARTUP_PARALLEL` | `2` | supervisor | Terminals spawned per startup batch |
| `STARTUP_BATCH_WAIT` | `3` | supervisor | Seconds between startup batches |
| `STARTUP_JITTER_MAX` | `3` | supervisor | Max random delay before a bridge calls `mt5.initialize()` |
| `BACKOFF_RESET_AFTER` | `60` | supervisor | Uptime (seconds) after which a terminal's restart backoff resets to the start |
| `HISTORY_SYNC_INTERVAL` | `30` | bridge | Seconds between closed-trade history syncs |
| `HISTORY_TOTALS_INTERVAL` | `HISTORY_SYNC_INTERVAL` | bridge | Seconds between `history_orders_total` / `history_deals_total` probes |
| `HISTORY_STREAM_MAXLEN` | `100000` | bridge | Approximate max entries kept per Redis stream before trimming |
| `HISTORY_BACKFILL_DAYS` | `0` | bridge | Initial closed-trade history window when no cursor exists; `0` means all available MT5 history |

Restart backoff per terminal follows `1, 2, 4, 8, 16, 30, 60, 120` seconds — a terminal that keeps failing immediately (bad login, closed window) backs off independently of healthy terminals.

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
The bridge also calls `mt5.initialize(path=terminal64.exe, portable=True)`, so direct bridge runs and supervisor-spawned runs both use MT5 portable mode.

### 5. Spike test (recommended before production)

```bash
python spike/test_dual_connect.py "C:\MT1\terminal64.exe" "C:\MT2\terminal64.exe"
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
nssm.exe set MT5Bridge Application C:\Python314\python.exe
nssm.exe set MT5Bridge AppParameters "C:\analytic\bridge\run_all.py --redis-url redis://:9717@therng.duckdns.org:6379"
nssm.exe set MT5Bridge AppDirectory C:\analytic\bridge
nssm.exe set MT5Bridge AppStdout C:\analytic\bridge\mt5_out.log
nssm.exe set MT5Bridge AppStderr C:\analytic\bridge\mt5_err.log
nssm.exe set MT5Bridge AppExit Default Restart
nssm.exe set MT5Bridge AppRestartDelay 5000
nssm.exe set MT5Bridge AppThrottle 1500
sc.exe config MT5Bridge start= auto
```

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| `mt5.initialize failed` | Terminal not running, or wrong path |
| `account_info()` returns `None` | Terminal open but not logged in |
| Redis connection refused | SSH tunnel down, or wrong `REDIS_URL` |
| Dashboard shows stale data | Bridge stopped; `positions` key expired (TTL 10s) |
| No terminals discovered | Shortcuts missing `/portable` flag or not in Startup folder |

## Historical Backfill

The bridge no longer depends on FTP. For a fresh account, delete
`mt5:bridge:history-cursor:{login}` before starting the bridge process to make
it rescan all available MT5 history by default. The Node worker discovers
accounts from `mt5:account:{login}:live`, creates missing `TradingAccount`
rows, then consumes the deals, orders, and closed-position streams into
PostgreSQL.
