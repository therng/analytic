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
  cursor (`mt5:bridge:history-cursor:{login}`) tracks the last-synced deal
  time so restarts resume instead of rescanning.
- Tracks running MAE/MFE per open position and running peak-equity/drawdown
  per account (see `tracking.py`), persisted to
  `mt5:account:{login}:position-state` / `:equity-state` every poll so a
  restart doesn't lose mid-life tracking.
- Publishes one enriched event to `mt5:account:{login}:position-closed-stream`
  per closed position (final MAE/MFE, entry/exit price+time, duration).

This is the data source for the `Position`/`Deal`/`Order` tables during and
after the FTP-report-pipeline migration — see
`docs/superpowers/specs/2026-07-02-bridge-ftp-migration-design.md` and
`docs/superpowers/plans/2026-07-02-bridge-ftp-migration.md`.

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
| `HISTORY_STREAM_MAXLEN` | `10000` | bridge | Approximate max entries kept per Redis stream before trimming |

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
nssm install MT5Bridge "C:\Python314\python.exe" "C:\analytic\bridge\run_all.py"
nssm set MT5Bridge AppEnvironmentExtra REDIS_URL=redis://:9717@therng.duckdns.org:6379
nssm set MT5Bridge AppDirectory C:\analytic\bridge
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

## Cutover procedure (FTP -> bridge, once validated)

1. Run `node --import tsx scripts/compare-bridge-ftp.ts` daily during the
   validation window; confirm zero missing/mismatched rows across all
   accounts for several consecutive days.
2. In `src/worker/bridge-consumer.ts`, change `processStreamEntry`'s target
   models from `bridgeDeal`/`bridgeOrder`/`bridgePosition` to
   `deal`/`order`/`position` (the real tables) and their corresponding
   unique-key `where` clauses (`dealNo`, `orderTicket`, `positionNo` are
   already the same key shape, only the model name changes).
3. Disable the FTP poll loop in `src/worker/index.ts` (`runWorker`'s
   `processReports()` call) behind an env var (e.g. `FTP_IMPORT_ENABLED=false`)
   rather than deleting it immediately, so it can be re-enabled quickly if an
   issue surfaces post-cutover.
4. Monitor for one full week; if stable, remove the FTP/cheerio parser code
   (`src/lib/parser/`, the FTP-poll portions of `src/worker/index.ts`) and
   the `Bridge*` shadow tables in a follow-up cleanup change.
