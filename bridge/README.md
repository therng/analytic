# MT5 Bridge

Windows-only Python bridge. Connects to MetaTrader 5 terminals, streams live
account state to Redis every 2s, and syncs closed-trade history into Redis
Streams every 30s. One process per terminal/login.

## Files

| File | Purpose |
|------|---------|
| `mt5_bridge.py` | Core bridge — one terminal, polls MT5, pushes to Redis |
| `run_all.py` | Supervisor — discovers terminals, spawns + restarts bridge processes |
| `discover_terminals.py` | Finds MT5 terminal paths from Windows Startup `.lnk` shortcuts |
| `tracking.py` | Pure MAE/MFE + equity-drawdown tracking logic (no MT5/Redis dependency, `pytest`-tested) |
| `requirements.txt` | Python dependencies |
| `spike/test_dual_connect.py` | Sanity check: two terminals connecting simultaneously |

## How it works

```
MT5 Terminal(s)
      │ MetaTrader5 Python API
      ▼
mt5_bridge.py (one process per account)
  • polls account_info() / positions_get() every POLL_INTERVAL (2s)
  • auto-reconnects on MT5 disconnect
  • syncs closed-trade history every HISTORY_SYNC_INTERVAL (30s)
  • tracks running MAE/MFE per open position, peak-equity/drawdown per account
  • writes to Redis (see schema below)

run_all.py ── discovers terminals via discover_terminals.py
  • spawns terminals in batches with startup jitter
  • per-terminal exponential backoff on restart (1s → 120s)
  • graceful shutdown (CTRL_BREAK_EVENT) releases each bridge's Redis lock
```

Downstream: the Node worker (`src/worker/`) consumes the Redis streams into
PostgreSQL (`Position` / `Deal` / `Order` tables), idempotently, by ticket.

## Redis schema

### `mt5:account:{login}:live` — Hash, no TTL

Account financials, refreshed every poll. Fields map 1:1 to MT5's
`account_info()` / `terminal_info()` (`balance`, `equity`, `margin`,
`freeMargin`, `marginLevel`, `profit`, `credit`, `currency`, terminal
connection/build info, etc.) plus a few derived counters:

| Field | Source | Notes |
|-------|--------|-------|
| `ordersTotal` | `orders_total()` | Pending orders |
| `positionsTotal` | `positions_total()` | Open positions |
| `historyOrdersTotal` / `historyDealsTotal` | `history_orders_total()` / `history_deals_total()` | For the configured history window |
| `historyTotalsUpdatedAt` | bridge clock | Unix timestamp of last refresh |

### `mt5:account:{login}:positions` — JSON string, TTL 10s

Array of open positions. Key absent/expired = bridge offline (stale), not
"no open positions."

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

`type`: `0` = Buy, `1` = Sell. `sl`/`tp`: `0` means not set. `openTime`: Unix
seconds.

### `mt5:bridge:heartbeat:{login}` — Hash, TTL 10s

Liveness signal, independent of `positions`. Absence means the process is
dead/stuck — not just flat on open trades.

| Field | Description |
|-------|-------------|
| `pid` | Bridge process PID |
| `lastSeen` | Unix timestamp of last successful poll |
| `reconnects` | MT5 reconnect count this run |
| `errors` | Poll error count this run |

### History streams

Every `HISTORY_SYNC_INTERVAL` (default 30s), the bridge calls
`history_deals_get()` / `history_orders_get()` and publishes new records to:

- `mt5:account:{login}:deals-stream`
- `mt5:account:{login}:orders-stream`
- `mt5:account:{login}:position-closed-stream` — one enriched event per
  closed position: final MAE/MFE, entry/exit price+time, duration, and
  `sl`/`tp` taken from the entry order (falls back to the exit order if the
  entry order wasn't captured, `null` if neither had a stop). If the closing
  deal isn't visible yet on the same poll (MT5 can lag), `exitPrice` /
  `profit` / `commission` / `swap` / `dealTicket` / `orderTicket` publish as
  `null` with `exitTime` falling back to "now" — treat a null `exitPrice` as
  pending enrichment, not permanent.

`mt5:bridge:history-ack:{login}` mirrors the PostgreSQL checkpoint. It is the
only coordination input accepted by the bridge; missing or invalid mirror
means wait and log, never guess a recent cursor. PostgreSQL stores the
authoritative coverage boundary, independent Deal/Order cursors, completion
phase, empty-chunk proof, and cross-window reconstruction state. The bridge
starts incomplete accounts at `2000-01-01`, fetches bounded
`HISTORY_CHUNK_DAYS` windows, emits Deal/Order/Position barriers, and advances
only after the worker commits the complete chunk and refreshes this mirror.
`mt5:bridge:history-cursor:{login}` remains a derived compatibility mirror.
Deal payloads carry both
existing camelCase fields and the report-contract aliases from
`docs/words.md` (`deal_id`, `order_id`, `position_no`, `direction`,
`balance_after`) so blank-type MT5 rows stay classifiable by
`symbol + direction`.

`tracking.py` state (running MAE/MFE per open position, peak-equity/drawdown
per account) persists to `mt5:account:{login}:position-state` /
`:equity-state` every poll, so a restart doesn't lose mid-life tracking.

These streams are the sole source for the `Position`/`Deal`/`Order` tables —
no FTP, no HTML reports.

## Configuration

Env vars (`bridge/.env` or process environment), all optional:

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
| `STARTUP_JITTER_MAX` | `3` | supervisor | Max random delay before `mt5.initialize()` |
| `BACKOFF_RESET_AFTER` | `60` | supervisor | Uptime after which restart backoff resets |
| `HISTORY_SYNC_INTERVAL` | `30` | bridge | Seconds between closed-trade history syncs |
| `HISTORY_TOTALS_INTERVAL` | `HISTORY_SYNC_INTERVAL` | bridge | Seconds between history-total probes |
| `HISTORY_CHUNK_DAYS` | `30` | bridge | Bounded automatic history window size |
| `HISTORY_RETRY_ATTEMPTS` | `3` | bridge | Retries per bounded MT5 history call |
| `HISTORY_RETRY_BACKOFF` | `2.0` | bridge | Seconds multiplied by retry attempt |

Restart backoff per terminal: `1, 2, 4, 8, 16, 30, 60, 120` seconds —
independent per terminal, so one bad login doesn't throttle healthy ones.

## Setup

1. **Install dependencies** (Windows only — `MetaTrader5`, `winshell`,
   `pywin32` require it):

   ```bash
   pip install -r requirements.txt
   ```

2. **Configure Redis** — create `bridge/.env`:

   ```env
   REDIS_URL=redis://:yourpassword@127.0.0.1:6379
   ```

3. **Tunnel forexvps to Redis** (run on forexvps, keep alive via Task
   Scheduler or nssm):

   ```bash
   ssh -N -L 6379:localhost:6379 user@central-server
   ```

   Test: `redis-cli -p 6379 -a yourpassword ping`

4. **Verify terminal discovery:**

   ```bash
   python discover_terminals.py
   ```

   Each MT5 terminal shortcut in
   `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` must have
   `/portable` in its arguments. `run_all.py` and direct `mt5_bridge.py` runs
   both call `mt5.initialize(path=terminal64.exe, portable=True)`, so both
   paths behave the same.

5. **Spike test** (recommended before production — confirms multi-terminal
   connect works and each returns a distinct login):

   ```bash
   python spike/test_dual_connect.py "C:\MT1\terminal64.exe" "C:\MT2\terminal64.exe"
   ```

6. **Run:**

   ```bash
   python run_all.py
   ```

   Processes auto-restart if they crash.

## Production (Windows Service via nssm)

Runs `run_all.py` as a [nssm](https://nssm.cc/) service — survives reboot,
restarts on crash. Logs go to `mt5_out.log` / `mt5_err.log` next to
`run_all.py`; check those first if the service won't come up.

```bash
nssm.exe install MT5Bridge C:\Python314\python.exe
nssm.exe set MT5Bridge AppParameters "C:\analytic\bridge\run_all.py --redis-url redis://:9717@therng.duckdns.org:6379"
nssm.exe set MT5Bridge AppDirectory C:\analytic\bridge
nssm.exe set MT5Bridge AppStdout C:\analytic\bridge\mt5_out.log
nssm.exe set MT5Bridge AppStderr C:\analytic\bridge\mt5_err.log
nssm.exe set MT5Bridge AppExit Default Restart
nssm.exe set MT5Bridge AppRestartDelay 5000
nssm.exe set MT5Bridge AppThrottle 1500
sc.exe config MT5Bridge start= auto
nssm.exe start MT5Bridge
```

## Automatic historical backfill

History comes only from `mt5.history_deals_get()` /
`mt5.history_orders_get()` — no FTP, no HTML reports. The Node worker
discovers accounts from `mt5:account:{login}:live`, creates missing
`TradingAccount` rows, and consumes the deal/order/closed-position streams
into PostgreSQL (idempotent upsert by ticket — safe to re-run).

Normal bridge startup owns full-history lifecycle. No cursor plus no completed
PostgreSQL checkpoint creates an initial `backfill` row at `2000-01-01`.
Live polling stays active while history windows run. Each bounded chunk carries
stream-local ordinals, counts, and digests; worker persists rows idempotently,
records all three barriers transactionally, and mirrors the committed
checkpoint. Empty chunks are committed too, proving gap-free coverage.

Redis loss is recoverable: worker recreates `history-ack` and compatibility
cursor mirrors from PostgreSQL. If a complete checkpoint lacks a valid
incremental cursor, worker fails loudly and does not fall back to 30 days.

```bash
# 1. Discovery — read-only, prints MT5's actual history range, no writes.
python mt5_bridge.py --terminal-path "C:\...\terminal64.exe" --mode discover-history

# 2. Normal startup automatically backfills; no manual mode or backfill args.
```

Run discovery optionally per terminal (one MT5 login per terminal, same as the live bridge).
Check durable progress in PostgreSQL `BridgeHistoryCheckpoint` and
`BridgeHistoryChunk`; Redis `mt5:bridge:history-ack:{login}` is only a mirror.

After the worker drains the streams, verify:

```bash
node --import tsx scripts/verify-history-backfill.ts
```

Reports per-account `Deal`/`Order`/`Position` counts and min/max timestamps
from PostgreSQL against Redis `emittedDeals`/`emittedOrders` counts.

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| `mt5.initialize failed` | Terminal not running, or wrong path |
| `account_info()` returns `None` | Terminal open but not logged in |
| Redis connection refused | SSH tunnel down, or wrong `REDIS_URL` |
| Dashboard shows stale data | Bridge stopped; `positions` key expired (TTL 10s) |
| No terminals discovered | Shortcuts missing `/portable` flag or not in Startup folder |
