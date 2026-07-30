# MT5 Bridge V2

`bridge_v2` is the Python producer at the start of the live trading data
pipeline:

```text
running MT5 portable terminal
        │
        ├── account_info() + positions_get()
        │       └── Redis live state
        │
        └── history_deals_get() + history_orders_get()
                └── Redis Streams ──> worker-v2 ──> PostgreSQL
```

The bridge is intentionally small and source-faithful. It connects to an
already-running portable MT5 terminal, preserves the raw MT5 records, and
publishes them. Position reconstruction, durable checkpoint commits, and
PostgreSQL writes belong to `src/worker-v2`, not this package.

## Responsibilities

The bridge does:

- connect to one explicit `terminal64.exe` path in portable mode;
- publish current account and open-position state approximately every two
  seconds;
- publish bounded raw Deal and Order history windows;
- add deterministic chunk, ordinal, barrier, and digest metadata to history
  messages;
- enforce one running bridge per MT5 login with a Redis lock;
- supervise approved portable terminals when started through `run_all_v2.py`.

The bridge does not:

- start, stop, or control an MT5 terminal process;
- reconstruct closed positions or emit close events;
- calculate MAE/MFE or dashboard analytics;
- write PostgreSQL;
- decide durable history progress from its own publish cursor when durable mode
  is enabled.

This separation makes it possible to tell whether a value was wrong at the MT5
source, in the Redis transport, in worker processing, or in PostgreSQL.

## Requirements

Production runs on Windows because the `MetaTrader5` Python package and the
portable terminal are Windows components. The terminal must already be running
with `/portable`; V2 refuses to launch `terminal64.exe` implicitly.

Install dependencies from the repository root:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r bridge_v2\requirements.txt
```

The requirements include `MetaTrader5`, `redis`, `psutil`, Windows shortcut
discovery support, and `pytest` for tests. Redis must be reachable from the
bridge host. The bridge does not require a PostgreSQL connection.

## Quick start

### 1. Start the MT5 terminal

Start the approved portable terminal yourself, for example:

```powershell
& 'C:\MT5\terminal64.exe' /portable
```

Confirm that the terminal is logged into the intended account before starting
the bridge. V2 discovers the login from `account_info()`; it does not accept a
login argument as an authority.

### 2. Verify raw MT5 data without Redis

The Phase 1 exporter is useful before enabling downstream ingestion:

```powershell
python -m bridge_v2.raw_export `
  --terminal-path 'C:\MT5\terminal64.exe' `
  --from-date '2025-01-01T00:00:00' `
  --output '.\artifacts\<login>'
```

It writes:

| File | Contents |
| --- | --- |
| `account.json` | Raw `account_info()` fields |
| `terminal.json` | Raw `terminal_info()` fields |
| `open_positions.json` | Raw `positions_get()` rows |
| `deals.jsonl` | One serialized raw Deal per line |
| `orders.jsonl` | One serialized raw Order per line |
| `validation.json` | Counts, ranges, duplicates, references, enum histograms, and funding/cost diagnostics |
| `summary.json` | Call results, counts, and Decimal-based position reconciliation diagnostics |

An empty tuple from MT5 is a valid zero-row result. `None` is a failed MT5
call and an exception is an error; both abort the export rather than being
reported as an empty history window.

### 3. Run one bridge

```powershell
python -m bridge_v2.main `
  --terminal-path 'C:\MT5\terminal64.exe' `
  --redis-url 'redis://127.0.0.1:6379' `
  --from-date '2025-01-01T00:00:00' `
  --broker-utc-offset-minutes 180
```

`--redis-url` defaults to `REDIS_URL`, then `redis://127.0.0.1:6379`.
`--from-date` defaults to `V2_HISTORY_START` or `2025-01-01T00:00:00`.
The broker offset defaults to `V2_BROKER_UTC_OFFSET_MINUTES` or `180`.

### 4. Run the supervisor

For multiple approved portable terminals, use the account-level supervisor:

```powershell
python -m bridge_v2.run_all_v2 `
  --redis-url 'redis://127.0.0.1:6379' `
  --from-date '2025-01-01T00:00:00' `
  --broker-offset '7948784=180'
```

By default the supervisor scans approved `.lnk` files in the user Startup
folder. A shortcut must resolve to an absolute `terminal64.exe` and include
the `/portable` argument. To bypass discovery, repeat `--terminal-path`:

```powershell
python -m bridge_v2.run_all_v2 `
  --terminal-path 'C:\MT5\account-a\terminal64.exe' `
  --terminal-path 'C:\MT5\account-b\terminal64.exe'
```

`--primary-terminal LOGIN=PATH` selects the preferred candidate when multiple
terminals are logged into the same account. `--broker-offset LOGIN=MINUTES`
overrides the default per login. The supervisor only manages bridge child
processes; it never starts or stops `terminal64.exe` and never mutates history
cursor state.

## Data contracts

### Live Redis keys

| Key | Type | Writer | Meaning |
| --- | --- | --- | --- |
| `mt5:v2:account:{login}:live` | Hash | bridge | Current account fields: balance, equity, margin, free margin, margin level, floating profit, and account metadata |
| `mt5:v2:account:{login}:positions` | String | bridge | JSON array of current raw open positions |
| `mt5:v2:bridge:{login}:heartbeat` | Hash with 10-second TTL | bridge | `lastSeen` from Redis `TIME` and current position count |
| `mt5:v2:bridge:lock:{login}` | String with configured TTL | bridge | Per-login ownership lock containing the bridge PID |

The live position payload preserves ticket, identifier, symbol, type, magic,
reason, volume, prices, SL/TP, profit, swap, comment, `time`, and `time_msc`.
The live path never infers a closed position from a ticket disappearing.

### History streams

| Stream | Message types | Purpose |
| --- | --- | --- |
| `mt5:v2:history:deals` | `record`, trailing `barrier` | Raw MT5 Deals |
| `mt5:v2:history:orders` | `record`, trailing `barrier` | Raw MT5 Orders |

Each record message contains the protocol version, login, stream, chunk and
parent chunk ids, half-open server-time window, `reachedPresent`, ordinal,
expected count, event key, serialized raw payload, and `payloadSha256`.

Each stream ends a chunk with one barrier containing `recordCount` and the
deterministic `recordsSha256` chain. Records are sorted by `(time, ticket)`
before ordinals are assigned, so a retry can reproduce the same envelope even
if MT5 returns rows in a different order.

The worker consumes both streams and advances the PostgreSQL
`BridgeHistoryCheckpoint` only after the required records and barriers have
been validated and committed. Redis stream delivery or a bridge log line alone
is not proof of durable history.

### Bridge-owned history state

| Key | Durable mode | Legacy rollback mode |
| --- | --- | --- |
| `mt5:v2:history:{login}:cursor` | Written for compatibility and observability; not used as the next window authority | Publish-progress cursor and next window authority |
| `mt5:v2:history:{login}:ack` | Read-only mirror written by worker-v2 from PostgreSQL checkpoint | Not used |
| `mt5:v2:history:{login}:pending-window` | Holds the exact unconfirmed window for byte-stable replay | Not used |
| `mt5:v2:history:{login}:watermark` | Optional read-only freeze target for an operational rollout | Optional |

Durable mode is enabled for every account by default. A missing ACK starts at
the configured retained-history boundary (`2025-01-01` by default). Until the
worker confirms a window, the bridge republishes that exact window instead of
moving ahead with the wall clock.

Do not treat the ACK key as the source of truth: it is a Redis mirror. The
PostgreSQL checkpoint is authoritative and Redis recovery state may be rebuilt
from it.

## Time semantics

MT5 `time`, `time_setup`, `time_done`, and `time_msc` are broker trade-server
clock values encoded as epoch-like numbers. They are not necessarily UTC. The
same clock base is used by MT5 history calls and live position calls.

V2 therefore follows these rules:

1. Record timestamps are serialized verbatim; the bridge never shifts them.
2. `time_iso` is only a readable rendering of those raw digits with a `+00:00`
   suffix. It must not be interpreted as the true UTC instant.
3. The history query upper bound is computed in broker-local clock space using
   the configured broker offset, then reduced by the trailing grace period.
4. The Node worker applies the account's `brokerUtcOffsetMinutes` once before
   persisting the timestamp to PostgreSQL.
5. `--from-date` and `V2_HISTORY_START` are query boundaries, not timestamp
   conversion instructions.

The grace period defaults to 60 seconds (`V2_HISTORY_SYNC_GRACE_SECONDS`). It
protects against broker-side deposits/withdrawals appearing in MT5 history a
little after the polling wall clock has passed their timestamp.

## Configuration

All settings are optional environment overrides. CLI arguments take precedence
where the command exposes the same setting.

| Variable | Default | Purpose |
| --- | --- | --- |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection URL |
| `V2_HISTORY_START` | `2025-01-01T00:00:00` | Initial retained-history boundary |
| `V2_BROKER_UTC_OFFSET_MINUTES` | `180` | Default broker offset used for history-window bounds |
| `V2_LIVE_POLL_INTERVAL` | `2.0` | Live polling interval in seconds |
| `V2_HISTORY_WINDOW_DAYS` | `30` | Maximum history window size |
| `V2_HISTORY_SYNC_INTERVAL` | `30.0` | Delay between history sync attempts |
| `V2_HISTORY_SYNC_GRACE_SECONDS` | `60` | Trailing safety margin for history-window upper bounds |
| `V2_HISTORY_DURABLE_ACCOUNTS` | `*` | `*`, comma-separated logins, or empty only for an explicit legacy rollback |
| `V2_LOCK_TTL` | `15` | Per-login lock TTL in seconds |
| `V2_LOCK_REFRESH_INTERVAL` | `5` | Lock refresh interval in seconds |
| `V2_IPC_FAIL_THRESHOLD` | `5` | Consecutive live MT5 failures before bridge exit |
| `MT5_STARTUP_DIR` | auto-detected | Explicit Startup directory for shortcut discovery |
| `MT5_STARTUP_USER` | auto-detected | Windows user whose Startup directory should be scanned |

Use the account's actual broker offset. The default is a convenience for the
common UTC+3 setup, not a universal truth.

## Failure and recovery rules

- MT5 `None` results and raised exceptions are failures; they never become an
  empty successful window.
- A history cursor advances only after all records and both stream barriers
  publish successfully.
- Empty windows are valid and advance coverage; they are not evidence that MT5
  failed.
- Durable mode does not advance from the bridge cursor. It waits for the
  worker's PostgreSQL-backed ACK mirror.
- A lost per-login lock stops the bridge. The supervisor may then elect or
  restart a candidate.
- Repeated live MT5 failures trip the circuit breaker and exit so the
  supervisor can fail over.
- Redis stream publication is transport progress, not PostgreSQL durability.

If history appears stuck, inspect the PostgreSQL checkpoint first, then compare
the matching Redis ACK, pending window, stream tail, and worker logs. Do not
reset business rows or advance a cursor by hand to make the dashboard move.

## Tests

Run the bridge tests from the repository root:

```powershell
python3 -m pytest -q bridge_v2/tests
```

The suite covers raw serialization, MT5 result classification, empty and
failed calls, time handling, durable replay envelopes, Redis lock behavior,
terminal discovery, supervisor election/failover, and validation diagnostics.
Most tests do not require MT5, Redis, or a Windows terminal. The Redis durable
integration test is opt-in and requires the isolated test Redis stack plus
`redis-py`:

```powershell
python3 -m pytest -q bridge_v2/tests/test_history_publisher_durable_redis_integration.py
```

## Source map

| Module | Role |
| --- | --- |
| `mt5_client.py` | Thin MT5 wrapper and honest `OK`/`FAILED`/`ERROR` classification |
| `live_publisher.py` | Live account, positions, and heartbeat publication |
| `history_publisher.py` | Bounded history windows, durable replay, envelopes, barriers, and digests |
| `main.py` | One-terminal bridge process and live/history loops |
| `run_all_v2.py` | Account-level terminal election, child supervision, and bounded failover |
| `raw_export.py` | Offline raw-data verifier and diagnostics |
| `terminal_discovery.py` | Approved portable-terminal shortcut discovery |
| `serializers.py` / `models.py` | Field-preserving serialization and MT5 enum labels |

For the consumer-side checkpoint contract, see
`src/worker-v2/history-checkpoint.ts` and the worker-v2 history tests. For the
database and source-of-truth boundaries, see `CLAUDE.md` and
`docs/architecture-data-models.md`.
