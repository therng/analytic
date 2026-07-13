# Automatic MT5 History Backfill Durability Design

**Status:** Approved for local implementation on 2026-07-13. Production execution remains blocked pending migration, diff, tests, and execution-plan review.

## Goal

Normal Python bridge startup must keep live polling active while automatically filling complete MT5 Deal and Order history from `2000-01-01` in bounded chunks. PostgreSQL is authoritative for coverage, cursors, completion, and cross-chunk reconstruction state. Redis transports records, barriers, and a rebuildable checkpoint mirror.

## Invariants

- `MIN_HISTORY_START_TS` is `2000-01-01` in raw MT5 server-time seconds.
- Missing PostgreSQL checkpoint means incomplete account. Worker creates initial `backfill` checkpoint at minimum boundary.
- Bridge never uses Unix epoch or `now - 30 days` as implicit start.
- Bridge never advances coverage or Deal/Order cursors after Redis publication alone.
- Worker advances checkpoint only after Deal, Order, and Position barriers for same chunk were encountered, every expected ordinal was durably applied, and all applied counts match barrier counts.
- Empty chunks publish all three barriers and receive durable chunk-ledger rows, proving contiguous coverage.
- Deal and Order cursors remain independent `(server timestamp, ticket)` tuples.
- Chunk windows remain bounded by configurable `HISTORY_CHUNK_DAYS`.
- Cross-chunk open-position reconstruction state is stored with completed PostgreSQL checkpoint and restored by bridge after restart.
- Raw MT5 times remain unchanged in Python and Redis. Node mapper converts Deal, Order, and Position times to UTC once using `brokerUtcOffsetMinutes`.
- Python bridge never connects PostgreSQL.
- Redis loss never loses durable progress. Worker reconstructs checkpoint and legacy cursor mirrors from PostgreSQL.
- Unsafe or inconsistent durable state fails loudly. No recent-window fallback.

## State Machine

States:

- `awaiting-checkpoint`: live polling runs; history thread waits for worker-produced Redis mirror.
- `backfill`: next bounded window begins at PostgreSQL-confirmed `completedThroughServerTime`.
- `awaiting-ack`: chunk records and barriers were published; bridge waits for durable mirror advancement.
- `incremental`: full-history completion was confirmed; same bounded/acknowledged mechanism covers new time.
- `blocked`: mirror/checkpoint is malformed, regresses, skips coverage, or cannot safely reconstruct cursor/state. Live polling continues; history logs explicit error and does not guess.

Transition:

```text
no checkpoint row
  -> worker creates backfill checkpoint at 2000-01-01
  -> worker mirrors checkpoint to Redis
  -> bridge publishes bounded chunk records
  -> bridge publishes Deal/Order/Position barriers
  -> worker persists preceding records in stream order
  -> final barrier transaction completes chunk ledger + advances checkpoint
  -> worker mirrors committed checkpoint
  -> bridge reloads mirror and starts next chunk
  -> final backfill chunk sets phase=incremental and backfillCompletedAt
  -> bounded incremental chunks continue through same protocol
```

Bridge does not require exact acknowledgment of its latest attempted chunk. If a prior attempt wins after restart, any strictly advancing durable checkpoint is accepted and bridge replans from its confirmed boundary. A checkpoint that skips forward beyond a published contiguous chunk or regresses is rejected.

## Redis Contract

Automatic lifecycle entries use versioned envelopes. Legacy entries with only `data` remain processable, but can never advance durable history coverage.

Every automatic record entry carries:

- deterministic chunk ID and parent checkpoint ID
- raw window start/end
- stream-local zero-based ordinal
- stream-local expected record count
- stable event key (ticket/position ID)
- exact payload JSON and SHA-256

Worker applies ordinals strictly. `ordinal == appliedCount` persists business row and increments count in one transaction. `ordinal < appliedCount` is idempotent replay. `ordinal > appliedCount` is loss/gap and remains unacknowledged. Thus Redis trimming or partial loss cannot produce false completion.

Each bounded chunk ends with one `history-barrier` entry on each stream:

- `mt5:account:{login}:deals-stream`
- `mt5:account:{login}:orders-stream`
- `mt5:account:{login}:position-closed-stream`

Barrier `data` JSON:

```json
{
  "version": 1,
  "chunkId": "sha256",
  "stream": "deals",
  "windowStartServerTime": 946684800,
  "windowEndServerTime": 949276800,
  "recordCount": 0,
  "recordsSha256": "sha256",
  "dealCursor": { "time": 946684800, "ticket": 0 },
  "orderCursor": { "time": 946684800, "ticket": 0 },
  "reachedPresent": false,
  "reconstructionState": null
}
```

Only Position barrier carries reconstruction snapshot; other barriers carry `null`. All core metadata must match. Chunk ID is deterministic from account, coverage window, and target Deal/Order cursors.

Worker publishes committed checkpoint mirror to:

- `mt5:bridge:history-ack:{login}` — full versioned checkpoint payload.
- `mt5:bridge:history-cursor:{login}` — compatibility mirror containing independent Deal/Order cursors.

Neither key is authoritative.

## PostgreSQL Model

`BridgeHistoryCheckpoint` contains one hot row per account:

- phase (`backfill` or `incremental`)
- coverage start and completed-through raw server timestamps
- independent Deal/Order raw server timestamp + ticket cursors
- last completed chunk ID
- opaque bounded reconstruction JSON
- backfill completion timestamp
- created/updated timestamps

`BridgeHistoryChunk` is append-oriented proof:

- deterministic chunk ID
- account and raw server-time window
- target independent cursors
- reached-present flag
- expected/applied count per stream
- last contiguous ordinal per stream
- per-stream barrier timestamps
- per-stream barrier Redis IDs for post-commit trimming
- reconstruction JSON from Position barrier
- completion timestamp

`BridgeHistoryRecord` is an ingest receipt keyed by `(chunk, stream, ordinal)`.
It stores event key and payload digest. Same ordinal plus same digest is a
no-op replay; same ordinal plus a different digest is a protocol error.

Constraints enforce positive ordered windows, non-regressing raw timestamps, valid phase/completion combinations, and account cascade. Unique `(account, window start, window end, chunk ID)` plus account/completion index support idempotency and recovery.

## Worker Transaction

For each automatic entry:

1. Validate envelope version, account, stream, chunk/parent IDs, raw window, cursor tuples, ordinal/count, and payload hash.
2. Create or validate single active chunk row from envelope metadata.
3. For record entry, lock chunk; validate/create `(chunk, stream, ordinal)` receipt; require ordinal not ahead of applied count; persist domain row and increment applied count in same transaction.
4. For barrier entry, require applied count equals expected count and rolling payload digest equals barrier digest; then set matching barrier timestamp/Redis ID. Position barrier also persists reconstruction JSON.
5. Read chunk and account checkpoint inside same transaction.
6. If fewer than three valid barriers exist, commit chunk state only; do not advance checkpoint.
7. If all barriers exist and chunk start/parent/cursors equal checkpoint state, atomically set chunk completion and advance checkpoint/cursors/reconstruction state.
8. If chunk is already committed, handle exact replay idempotently without regressing checkpoint. Any fork, gap, metadata mismatch, or cursor regression throws and remains pending.
9. After transaction commit, publish Redis mirrors. Redis failure leaves barrier pending for retry; PostgreSQL remains correct.
10. ACK Redis entry only after its PostgreSQL transaction succeeds. Durable ACK mirror is published only after full chunk commit.
11. Trim committed stream entries through stored barrier IDs only after durable mirror publication; trimming failure affects cleanup, not checkpoint truth.

## Restart and Redis-Loss Recovery

- Worker ensures every discovered PostgreSQL account has checkpoint row.
- Worker validates each row before mirroring it.
- Complete checkpoint safely reconstructs both acknowledgment and legacy cursor mirror.
- Missing checkpoint starts full replay from minimum boundary, even when old business rows exist. Replaying is safer than assuming gap-free coverage.
- Malformed complete checkpoint, missing independent cursor, impossible phase, or non-contiguous coverage produces explicit error and no fallback mirror.
- Bridge restores cross-chunk reconstruction snapshot from mirror before next window.
- Redis stream/dedupe loss can re-deliver records. PostgreSQL chunk ordinals, unique business keys, and upserts preserve idempotency.

## Time Contract

Python treats MT5 numeric times as opaque server-time seconds. It uses them for query windows, cursors, barriers, and reconstruction without applying broker offset. Redis stores same numbers. Node record mappers remain sole conversion boundary via `serverTimeToUtc(rawTime, brokerUtcOffsetMinutes)`. PostgreSQL checkpoint metadata intentionally stores raw server seconds as `BIGINT`; it is coordination metadata, not UTC event time.

## CLI and Configuration

- Remove `HISTORY_BACKFILL_DAYS` behavior.
- Remove `--mode backfill-history`, `--backfill-window-days`, and `--backfill-start-date`.
- Remove standalone manual backfill execution path after automatic lifecycle passes tests.
- Keep read-only history discovery diagnostic.
- Add `HISTORY_CHUNK_DAYS`, default `30`, validated `> 0`.
- Keep retry count/backoff configuration for bounded MT5 calls.

## Failure Handling

- MT5 bounded-call failure: retry configured attempts; publish no barriers for failed chunk; retry same durable boundary later.
- Partial Redis publication or trimming: missing ordinal/count/digest prevents PostgreSQL checkpoint advancement. Replay remains idempotent.
- Worker/database unavailable: live polling continues; history waits and logs.
- Redis unavailable: current bridge Redis failure policy applies; supervisor restart resumes from PostgreSQL mirror.
- Inconsistent durable state: block history synchronization loudly; never use epoch or 30-day fallback.

## Verification

- Python state-machine tests: minimum start, bounded windows, publish-without-ack, restart/resume, stale competing chunk, incremental switch, malformed mirror failure, reconstruction round trip, CLI removal.
- Node durability tests: business upsert + ordinal increment atomicity, duplicate/gapped ordinal behavior, expected/applied count checks, one/two barriers do not advance, three barriers advance transactionally, empty chunk advances, duplicate/fork rejection, reconstruction persistence, mirror-after-commit ordering, Redis-loss hydration, unsafe complete cursor rejection.
- Mapper tests: raw server time converted exactly once for Deal/Order/Position.
- Prisma schema validation and generated migration inspection.
- Existing bridge, worker mapper/consumer, analytics, lint, and build checks.

## Production Gate

Before migration application, deploy, Redis changes, or history rebuild, present:

- migration SQL and risk/rollback notes
- complete scoped diff
- focused and baseline test output
- execution/deployment plan

No production data deletion, Redis reset, rebuild, deployment, commit, or push belongs to this implementation phase.
