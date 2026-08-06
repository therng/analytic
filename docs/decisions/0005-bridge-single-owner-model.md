# ADR-0005: Two-layer single-owner enforcement for the native bridge

## Status

Accepted

## Date

2026-07-30

## Context

Each MT5 account/login must have exactly one live producer writing its
`:live` and `:stream:history` Redis data (ADR-0003) at any time — a
duplicate producer (e.g. two terminals sharing one login, or a crashed
process that never released ownership) would corrupt the stream with
interleaved or conflicting writes. Duplicate ownership can happen at two
different scopes: two processes on the *same host* racing for the same
login, and a *stale/lost-lease* producer on any host continuing to write
after another producer has taken over.

## Decision

Enforce single ownership with two independent layers:

1. **Local filesystem lock** (`bridge/ownership.py`) — prevents two
   processes on the same host from claiming the same login.
2. **Distributed Redis lease with monotonic fencing tokens**
   (`bridge/redis_transport.py`'s `RedisLease`/`acquire`, backed by a Lua
   script) — every live/history write (`publish_live_fenced`,
   `append_stream_fenced`) requires the current fencing token, so a stale or
   lost-lease producer's writes are rejected even if it hasn't noticed it
   lost ownership yet. `bridge/health.py`'s `LeaseFence` persists
   `coordination_epoch`/`fencing_token` as durable proof of current
   ownership; `bridge/worker.py`'s background `LeaseRenewalThread` runs
   independently of the poll loop so a slow/blocked MT5 call can never delay
   renewal.

`bridge/supervisor.py` owns process lifecycle (start/restart/quarantine) on
top of both layers, and `bridge/discovery.py` dedupes duplicate-login
warnings so two terminals sharing one login are collapsed to one worker, not
run twice.

## Alternatives Considered

### Local lock only

- Pros: simple, no Redis round-trip needed to detect a conflict.
- Cons: does nothing for cross-host duplication or a process that holds the
  local lock but has actually lost network/Redis connectivity and can no
  longer be trusted as the sole writer.
- Rejected as the sole mechanism: local locking can't protect the shared
  Redis data itself.

### Redis lease only

- Pros: covers cross-host and stale-writer cases directly at the data layer.
- Cons: two processes on the *same host* could both attempt to acquire the
  lease in a tight race before either notices the other, and a local
  filesystem check is cheaper/faster to fail closed on than a Redis
  round-trip for the common single-host duplicate-launch case.
- Rejected as the sole mechanism: doesn't cover the local-duplicate-launch
  case as directly or cheaply.

### Both layers together (chosen)

- Pros: local lock fails closed fast for the common same-host case; the
  fenced Redis lease is the authoritative cross-host guarantee that actually
  protects the shared data, with fencing tokens making even a delayed/
  confused writer's requests rejected by construction rather than by trust.
- Cons: two mechanisms to keep in sync conceptually; more moving parts than
  either alone.

## Consequences

- A write to `:live` or `:stream:history` without a current fencing token is
  rejected at the transport layer, not merely discouraged by convention.
- Verified in production: auto-discovery correctly read 5 accounts from 6
  live terminals, with 2 terminals sharing one login deduped to 1 worker.
- Renewal is decoupled from the poll loop specifically so an MT5 API stall
  cannot silently cause a lease to expire out from under an otherwise-healthy
  producer.
- Future single-owner changes must consider both layers — a fix that only
  patches the local lock or only patches the Redis lease leaves the other
  duplication path open.

## Evidence

- `0e647c1` (2026-07-30) — "feat(mt5-native-bridge): add greenfield scaffold,
  prune zero-impl protocols" — introduces the fencing-lease Redis transport.
- `e613819` (2026-07-31) — "feat(bridge): outbox+ACK, auto-discovery, and
  full supervision layer" — adds `bridge/supervisor.py` (lifecycle/restart/
  quarantine) and discovery dedup; verified in production: "discovery
  correctly read 5 accounts from 6 live terminals (2 terminals sharing one
  login, deduped to 1 worker)."
- `da4d09d` (2026-07-30) — clarifies "fence-counter is the source of the
  lease's token snapshot, not an independent counter."
- `bridge/health.py:12-16` — `LeaseFence` dataclass
  (`coordination_epoch`, `fencing_token`).
- `bridge/redis_transport.py` `cluster_keys` (~lines 90-99) and `acquire`
  (~lines 110-117) — Lua-scripted acquire, raises `LeaseUnavailable` if not
  `"ACQUIRED"`.
- `bridge/worker.py`'s `is_lease_stale`/`LeaseRenewalThread` docstring —
  "Background renewal, independent of the poll loop so a slow/blocked MT5
  call can never delay a renewal attempt."
- `bridge/ownership.py:9-15` — `LocalOwnershipUnavailable`/
  `StaleLocalLockEvidence`/`LocalLock`, the local single-host guard.
