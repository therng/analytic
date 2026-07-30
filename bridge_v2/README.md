# bridge_v2

`bridge_v2` is the Windows-side MT5 producer for Analytic. It reads one or
more already-running portable MetaTrader 5 terminals and publishes two kinds
of data to Redis:

```text
MT5 terminal  ->  bridge_v2  ->  Redis  ->  worker-v2  ->  PostgreSQL
                    │              │
                    │              ├─ live account/position state
                    │              └─ Deal/Order history streams
                    └─ no position reconstruction, no database writes
```

The bridge preserves MT5 records. `worker-v2` owns position reconstruction,
durable checkpoint commits, and PostgreSQL persistence.

## What it does

- Connects to an explicit, already-running `terminal64.exe` in `/portable`
  mode.
- Publishes account and open-position snapshots approximately every two
  seconds.
- Publishes bounded raw Deal and Order history windows.
- Adds deterministic chunk, ordinal, barrier, and SHA-256 metadata to history
  messages.
- Prevents two bridge processes from owning the same MT5 login.
- Supervises terminal candidates at account level through `run_all_v2.py`.

## What it does not do

- It never launches or controls `terminal64.exe`.
- It never turns a disappearing open ticket into a close event.
- It never reconstructs closed positions or computes MAE/MFE.
- It never writes PostgreSQL.
- It never treats Redis ACK state as durable authority; PostgreSQL is the
  authority for completed history.

## Production service

The production bridge runs on the Windows VPS, not inside this repository's
Linux/Docker stack:

| Item | Value |
| --- | --- |
| Host | `forexvps` |
| Code directory | `C:\analytic` |
| Service manager | NSSM, installed on the VPS |
| Service name | `MT5BridgeV2` |
| Service workload | `bridge_v2.run_all_v2` supervisor |

The service is account-level: if two terminals are logged into the same MT5
login, the supervisor elects one bridge child for that login. NSSM is an
installation/runtime dependency on the VPS; `nssm.exe` is intentionally not
checked into this repository.

Operational commands, from a machine with the `forexvps` SSH alias:

```bash
ssh forexvps 'nssm status MT5BridgeV2'
ssh forexvps 'nssm start MT5BridgeV2'
ssh forexvps 'nssm stop MT5BridgeV2'
ssh forexvps 'nssm restart MT5BridgeV2'
```

Restarting the service gracefully stops the supervisor, releases Redis locks,
rediscovers terminals, and respawns one child per account. It does not restart
or control the MT5 terminals themselves.

## Requirements

Production requires Windows, a running portable MT5 terminal, and reachable
Redis. The bridge refuses to initialize a terminal that is not already
running, so start MT5 separately with `/portable`.

Install from the repository root:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r bridge_v2\requirements.txt
```

The dependency file contains the MT5, Redis, Windows process/shortcut, and
test dependencies. The bridge itself has no PostgreSQL dependency.

## Run manually

### Check the raw source first

`raw_export` reads MT5 without Redis and writes an auditable artifact set:

```powershell
python -m bridge_v2.raw_export `
  --terminal-path 'C:\MT5\terminal64.exe' `
  --from-date '2025-01-01T00:00:00' `
  --output '.\artifacts\<login>'
```

Output files:

| File | Meaning |
| --- | --- |
| `account.json` / `terminal.json` | Raw account and terminal information |
| `open_positions.json` | Raw current positions |
| `deals.jsonl` / `orders.jsonl` | One serialized raw MT5 record per line |
| `validation.json` | Counts, ranges, duplicates, references, enum and funding diagnostics |
| `summary.json` | Call results, counts, and Decimal reconciliation diagnostics |

An empty MT5 tuple is a valid zero-row result. MT5 `None` and raised
exceptions are failures; they are never silently reported as empty data.

### Run one bridge

```powershell
python -m bridge_v2.main `
  --terminal-path 'C:\MT5\terminal64.exe' `
  --redis-url 'redis://127.0.0.1:6379' `
  --from-date '2025-01-01T00:00:00' `
  --broker-utc-offset-minutes 180
```

### Run the supervisor

With explicit terminals:

```powershell
python -m bridge_v2.run_all_v2 `
  --terminal-path 'C:\MT5\account-a\terminal64.exe' `
  --terminal-path 'C:\MT5\account-b\terminal64.exe' `
  --broker-offset '7948784=180'
```

Without `--terminal-path`, the supervisor scans approved Windows Startup
shortcuts. Each accepted shortcut must resolve to an absolute `terminal64.exe`
and include `/portable`. `--primary-terminal LOGIN=PATH` selects the preferred
candidate when an account has multiple terminals.

## Redis contract

### Live state

| Key | Type | Meaning |
| --- | --- | --- |
| `mt5:v2:account:{login}:live` | Hash | Account metadata, balance, equity, margin, free margin, margin level, and floating P/L |
| `mt5:v2:account:{login}:positions` | JSON string | Current open-position array |
| `mt5:v2:bridge:{login}:heartbeat` | Hash, 10-second TTL | Redis-clock `lastSeen` and current position count |
| `mt5:v2:bridge:lock:{login}` | String, TTL | Bridge PID holding the per-login lock |

Live positions preserve ticket, identifier, symbol, type, magic, reason,
volume, open/current prices, SL/TP, profit, swap, comment, `time`, and
`time_msc`.

### History streams

| Stream | Contents |
| --- | --- |
| `mt5:v2:history:deals` | Raw Deal records and a barrier per chunk |
| `mt5:v2:history:orders` | Raw Order records and a barrier per chunk |

Each record envelope contains `version`, `login`, `stream`, `chunkId`,
`parentChunkId`, `windowStartServerTime`, `windowEndServerTime`,
`reachedPresent`, `ordinal`, `expectedCount`, `eventKey`, `payload`, and
`payloadSha256`.

Each stream's final message for a chunk is a barrier containing `recordCount`
and `recordsSha256`. Records are sorted by `(time, ticket)` before ordinals
are assigned. This makes retries deterministic even when MT5 returns rows in
a different order.

## Durable history

Durable mode is enabled for every login by default:
`V2_HISTORY_DURABLE_ACCOUNTS=*`.

The bridge uses these per-login keys:

| Key | Owner/meaning |
| --- | --- |
| `mt5:v2:history:{login}:ack` | Read-only Redis mirror written by worker-v2 from PostgreSQL |
| `mt5:v2:history:{login}:pending-window` | Exact unconfirmed window to replay byte-for-byte |
| `mt5:v2:history:{login}:cursor` | Compatibility/observability cursor; not the durable authority |
| `mt5:v2:history:{login}:watermark` | Optional rollout freeze target |

Rules:

1. Missing durable state starts at `2025-01-01T00:00:00`, never at epoch or
   `now - 30 days`.
2. The bridge republishes an unconfirmed window with the same chunk id until
   worker-v2 confirms it.
3. Worker-v2 advances PostgreSQL `BridgeHistoryCheckpoint` only after the
   required Deal and Order records, barriers, counts, digests, and transaction
   commit are complete.
4. Redis ACK is a derived mirror. After Redis loss, recover from PostgreSQL;
   do not advance a cursor manually to bypass a gap.
5. Empty windows are valid completed coverage and still advance the boundary.

Setting `V2_HISTORY_DURABLE_ACCOUNTS` to an empty value is an explicit rollback
to the legacy publish-progress cursor and should not be the normal mode.

## Time rules

MT5 `time`, `time_setup`, `time_done`, and `time_msc` use the broker
trade-server clock encoded as epoch-like values. They are not necessarily UTC.

- The bridge serializes record timestamps verbatim.
- `time_iso` is only a readable rendering of the raw value; it is not proof of
  the true UTC instant.
- The history query upper bound is calculated in broker-local clock space from
  the configured offset.
- A trailing grace period protects against delayed broker-side deposits and
  withdrawals. Its default is 60 seconds.
- The Node worker applies the account's `brokerUtcOffsetMinutes` once before
  persisting timestamps to PostgreSQL.

The offset is per login when using the supervisor:

```powershell
--broker-offset '7948784=180' --broker-offset '7954220=180'
```

The default offset is `180` minutes for the common UTC+3 setup, but every
account should be configured with its actual broker offset.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection URL |
| `V2_HISTORY_START` | `2025-01-01T00:00:00` | Initial history boundary |
| `V2_BROKER_UTC_OFFSET_MINUTES` | `180` | Default history-window broker offset |
| `V2_LIVE_POLL_INTERVAL` | `2.0` | Live poll interval, seconds |
| `V2_HISTORY_WINDOW_DAYS` | `30` | Maximum history window size |
| `V2_HISTORY_SYNC_INTERVAL` | `30.0` | Delay between history attempts, seconds |
| `V2_HISTORY_SYNC_GRACE_SECONDS` | `60` | Trailing history safety margin |
| `V2_HISTORY_DURABLE_ACCOUNTS` | `*` | Durable-mode allowlist |
| `V2_LOCK_TTL` | `15` | Login lock TTL, seconds |
| `V2_LOCK_REFRESH_INTERVAL` | `5` | Lock refresh interval, seconds |
| `V2_IPC_FAIL_THRESHOLD` | `5` | Consecutive live MT5 failures before exit |
| `MT5_STARTUP_DIR` | auto | Startup directory override |
| `MT5_STARTUP_USER` | auto | Windows user for Startup discovery |

CLI flags override the matching environment defaults. `--redis-url` and
`--from-date` are available on both bridge entry points; broker offset is
`--broker-utc-offset-minutes` on `main.py` and repeatable `--broker-offset` on
`run_all_v2.py`.

## Failure handling

- A failed MT5 call does not advance history or become an empty result.
- A history cursor advances only after both streams' records and barriers are
  published successfully.
- A lost Redis login lock stops the process.
- Five consecutive live MT5 failures trip the circuit breaker so the
  supervisor can restart or fail over the child.
- Redis publication proves transport progress only; it does not prove durable
  PostgreSQL persistence.

For a history stall, inspect in this order: PostgreSQL checkpoint, Redis ACK,
pending window, Redis stream tail, then worker-v2 logs. Avoid deleting business
rows or resetting Redis state unless the recovery runbook explicitly requires
it.

## Tests

From the repository root:

```bash
python3 -m pytest -q bridge_v2/tests
```

The suite covers MT5 result classification, serialization, time handling,
live publication, history envelopes and digests, durable replay, Redis locks,
terminal discovery, supervisor election/failover, and validation diagnostics.
The optional real-Redis test requires the isolated test Redis stack:

```bash
python3 -m pytest -q bridge_v2/tests/test_history_publisher_durable_redis_integration.py
```

## Source map

| File | Responsibility |
| --- | --- |
| `mt5_client.py` | Honest MT5 `OK` / `FAILED` / `ERROR` wrapper |
| `live_publisher.py` | Live account, positions, and heartbeat |
| `history_publisher.py` | Windows, envelopes, barriers, digests, and durable replay |
| `main.py` | One-terminal bridge process |
| `run_all_v2.py` | Account-level election and child supervision |
| `raw_export.py` | Offline raw-source verifier |
| `terminal_discovery.py` | Portable-terminal Startup shortcut discovery |
| `serializers.py` / `models.py` | Field-preserving serialization and enum labels |

The consumer-side checkpoint implementation is
`src/worker-v2/history-checkpoint.ts`. The VPS service runbook is
`.claude/skills/ssh-vps/references/bridge-service.md`.
