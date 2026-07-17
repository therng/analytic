# Worker V3 — Verified Redis Input Contract

**Status banner (2026-07-16):** Gated by [`docs/superpowers/plans/2026-07-16-history-first-dashboard-worker-v3.md`](superpowers/plans/2026-07-16-history-first-dashboard-worker-v3.md) Package 6 — Worker V3 P2 rollout does not start until all accounts pass the new plan's coverage acceptance criteria. `src/worker-v3/` remains scaffold-only.

Status: **verified against the repository on 2026-07-15**, not invented. Every
key, stream, and field below was read from `bridge_v2/` (the producer) and
cross-checked against `src/worker-v2/` (the current consumer). Source lines are
cited so this document can be re-verified.

> **Important framing.** The spec that requested "Worker V3" asks for a
> brand-new isolated worker under `src/worker-v3/`. A from-scratch modular
> worker already exists at `src/worker-v2/` and is under active development. It
> already consumes the contract documented here. This document describes the
> **real, current** producer contract regardless of which worker consumes it —
> it is valid input for finishing V2 or for a V3 fork. See
> `worker-v3-implementation-plan.md` for the V2-vs-V3 decision and gap analysis.

## 1. Namespace

All V2/V3 bridge keys live under the `mt5:v2:` namespace, deliberately isolated
from the legacy bridge's `mt5:account:<no>:*-stream` keys consumed by
`src/worker/`. Source: `bridge_v2/config.py:35`.

`login` in every key below is the MT5 account login rendered as a string. It
maps to `TradingAccount.accountNo` (see `src/worker-v2/account-registry.ts`,
`validators.ts` — every validator checks `String(login) === accountNo`).

## 2. History streams (durable transport)

Two shared Redis Streams — **not** per-account. Source: `bridge_v2/config.py:63-64`,
producer `bridge_v2/history_publisher.py:46`.

| Stream key              | Constant        | Contents                   |
| ----------------------- | --------------- | -------------------------- |
| `mt5:v2:history:deals`  | `STREAM_DEALS`  | one deal record per entry  |
| `mt5:v2:history:orders` | `STREAM_ORDERS` | one order record per entry |

Consumer group: `worker-v2` (`src/worker-v2/stream-consumer.ts:3`), created with
`XGROUP CREATE ... 0 MKSTREAM`. Consumer name:
`worker-v2-<pid>-<hostname>` (`stream-consumer.ts:9-11`).

### 2.1 Stream entry shape

Each `XADD` entry (`bridge_v2/history_publisher.py:_stream_message`,
`serializers.serialize_record`) is a flat field map containing:

- `login` — account login (string)
- `kind` — `"deals"` or `"orders"` (redundant with the stream, used for cross-check)
- the serialized MT5 record as JSON (consumer reads `entry.message.data` and
  `JSON.parse`s it — see `deal-consumer.ts` / `order-consumer.ts`).

Consumer validation cross-checks `login` against the resolved account and
rejects mismatches (`validators.validateDealRecord` / `validateOrderRecord`).

### 2.2 Deal record fields (JSON payload)

Read by `validateDealRecord` and `mapDealToPrisma`. Fields observed:

`ticket` (required), `time` (epoch seconds, broker-server time), `symbol`,
`type` (MT5 deal type int), `entry` (MT5 deal entry int: in/out/inout/out_by),
`volume`, `price`, `commission`, `swap`, `profit`, `fee`, `comment`, `order`
(order ticket), `position_id`.

Notes:

- `commission`, `swap`, `fee`, `profit` are **signed** values from MT5. Net P/L
  is `profit + commission + swap` (fee excluded, all added, none subtracted) —
  `mappers.computeDealNetProfit`.
- `time` is broker-server epoch; converted to UTC exactly once via
  `serverTimeToUtc(time, brokerUtcOffsetMinutes)` in the mapper.

### 2.3 Order record fields (JSON payload)

Read by `validateOrderRecord` and `mapOrderToPrisma`. Fields observed:

`ticket` (required), `position_id`, `symbol`, `type` (MT5 order type int),
`state`, `time_setup` (epoch), `time_done` (epoch), `volume_initial`,
`volume_current`, `price_open`, `price_current`, `sl`, `tp`, `price_stoplimit`,
`comment`. At least one of `time_setup` / `time_done` must be present.

## 3. Live state (transient, per-account)

Written every live tick by `bridge_v2/live_publisher.py:56-63`. **Not** a stream —
plain hash + JSON string + heartbeat hash. This is transient live state; it is
**not** authoritative and must not be treated as durable storage.

| Key                                | Type                | Source                 | Consumed by                 |
| ---------------------------------- | ------------------- | ---------------------- | --------------------------- |
| `mt5:v2:account:{login}:live`      | HASH                | `live_publisher.py:59` | `live-sync.syncAccountLive` |
| `mt5:v2:account:{login}:positions` | STRING (JSON array) | `live_publisher.py:62` | `live-sync.syncAccountLive` |
| `mt5:v2:bridge:{login}:heartbeat`  | HASH                | `live_publisher.py:63` | `live-sync.readHeartbeat`   |

### 3.1 Live hash fields

Read by `validateLiveHash` / `mapLiveToAccountSnapshot`:
`login`, `balance`, `equity`, `margin`, `margin_free`, `margin_level`
(nullable), `profit` (floating P/L), `credit`.

### 3.2 Positions JSON array — per element

Read by `validateOpenPositionCandidate` / `mapPositionToOpenPosition`:
`ticket` (required), `type` (position side int), `symbol`, `volume`,
`price_open`, `price_current`, `sl`, `tp`, `swap`, `profit`, `time` (open
epoch), `comment`, `magic`.

### 3.3 Heartbeat hash fields

Read by `live-sync.readHeartbeat`: `lastSeen` (epoch seconds, float),
`positions` (integer — expected count of the positions array).

**Completeness signal (current).** The only completeness metadata the producer
emits today is `heartbeat.positions` = expected count. The consumer refuses to
reconcile open positions unless the parsed array length equals this count
(`live-sync.ts:66-71`). There is **no** `snapshotId`, `snapshotGeneratedAt`,
`schemaVersion`, or explicit `complete` flag. The spec (§4.5) asks for those;
adding them is a **producer change** and must be documented separately per
spec §17 / §28.

## 4. History cursor (producer-side, not authoritative)

`mt5:v2:history:{login}:cursor` = JSON `{"epoch": <int>}`. Written by the
producer only (`history_publisher.py:37`). The bridge's own docstring states:
_"No barriers, no custom ACK, no PostgreSQL"_ (`history_publisher.py:4`).

**Consequence for V3.** Unlike the legacy bridge (`src/worker/`), the V2 bridge
provides **no barrier/checkpoint protocol** and no durable ingestion state.
Durable checkpointing (spec §12, §19) must be implemented **consumer-side in
PostgreSQL** (a `WorkerConsumerState` / checkpoint table), reconstructable
without Redis. The Redis cursor is a producer convenience mirror only.

## 5. What the contract does NOT provide (gaps vs spec)

Verified absent from the current producer:

- No `position-closed` stream. Closed positions are **reconstructed
  consumer-side from the deals stream** (`position-reconstructor.ts`).
- No working-order stream or working-order snapshot (spec §4.6). Not produced.
- No snapshot completeness envelope (`snapshotId` / `generatedAt` / `count` /
  `complete` / `schemaVersion`) beyond `heartbeat.positions` count.
- No account-identity message (company / server / owner / leverage / currency
  as a live event). Identity lives in `TradingAccount` rows, set operationally.
- No explicit per-message `schemaVersion` field on stream entries.
- No dead-letter stream.

Any of these that V3 requires from the producer is a **bridge change** and must
be proposed as the smallest compatible addition in a separate document, per
spec §17.

## 6. Ordering & idempotency facts

- Stream entries are **not** guaranteed in event-time order (history backfill
  publishes by cursor window; live and history interleave). Consumers must
  sort by event time, not delivery order — `position-reconstructor.sortDeals`
  already does `(time, ticket)`.
- Idempotency keys available from the contract: deal `ticket`
  (→ `Deal(tradingAccountId, dealNo)`), order `ticket`
  (→ `Order(tradingAccountId, orderTicket)`), `position_id`
  (→ `Position` / `ClosedPosition`). All are stable MT5 identifiers.
