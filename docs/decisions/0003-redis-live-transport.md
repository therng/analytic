# ADR-0003: Redis Streams as the sole live/history transport between the native bridge and Worker V2

## Status

Accepted

## Date

2026-08-01

## Context

The native bridge (`bridge/`) runs on a separate host (`forexvps`, Windows)
from Worker V2 and PostgreSQL (local Mac / Docker stack). Something has to
carry live account state and history events across that boundary without
either side polling the other's filesystem or database directly. The bridge
also needs a durable-ownership mechanism (see ADR-0005) that shares
infrastructure with the data transport, so key placement matters for cluster
hash-tag correctness, not just naming.

## Decision

Use Redis as the sole transport: the native bridge is the single writer to
`mt5:account:{login}:live` (current live account/position state) and
`mt5:account:{login}:stream:history` (Deal/Order/history-window events, one
stream per account). Worker V2 only ever reads these two keys per account —
it never writes live state back, and it does not own or reconstruct any
backfill/coverage state itself (that lives in the bridge's own SQLite
journal). Key builders are centralized in `src/lib/mt5-redis-keys.ts` on the
Node side and mirrored in `bridge/redis_transport.py`'s `cluster_keys` on the
Python side, so the two never drift independently.

## Alternatives Considered

### Direct DB writes from the bridge host

- Pros: no transport hop, Worker V2 wouldn't need to consume anything.
- Cons: the bridge host is Windows/VPS-based and would need direct network
  access to production PostgreSQL, plus the bridge would need to reimplement
  Worker V2's idempotent Deal/Order persistence itself.
- Rejected: couples the bridge's terminal-polling concerns to PostgreSQL
  transaction semantics, and removes Worker V2's role as the sole durable
  writer.

### Per-command Redis connections

- Pros: simpler mental model, no connection lifecycle to manage.
- Cons: called out explicitly as unacceptable in the Redis client contract
  work — a single pooled/multiplexed connection per producer was required
  instead.
- Rejected: per-command connections would multiply connection overhead per
  account and complicate `XREADGROUP BLOCK` semantics, which hold a socket
  for the duration of the block.

### Ambiguous key placeholder notation (`{login}` as literal text)

- Pros: none — this was a documentation bug, not a real alternative.
- Cons: `{login}`/`{producer_id}` read as template placeholders when they are
  actually literal Redis Cluster hash tags.
- Rejected/fixed: made brace literalness explicit and reordered keys to
  `{namespace}:{version}:{id}:{attribute}` so the lease keys and data keys
  for one account share a hash slot.

## Consequences

- One Redis namespace, `mt5:account:{login}:*`, replaces the retired
  `bridge_v2`'s `mt5:v2:*` namespace and the short-lived `mt5n:v1:*` native
  contract that preceded the redesign.
- `src/lib/mt5-redis-keys.ts` is the single Node-side place key strings are
  built; any change must be mirrored in `bridge/redis_transport.py`'s
  `cluster_keys` by convention, not enforced by a shared schema.
- Worker V2 stays a pure consumer of `:live` and `:stream:history` — it
  cannot originate a write to either key, which keeps the ownership boundary
  (bridge owns transport + coverage state, Postgres is Worker V2's durable
  output) unambiguous.
- Redis loss is transport loss, not data loss: durable history progress lives
  in the bridge's SQLite journal, not in these keys (see CLAUDE.md's History
  Backfill and Durability section).

## Evidence

- `0058de2` (2026-08-01) — "refactor(redis): redesign MT5 account namespace
  and unify Redis key generation" — migrates to `mt5:account:{login}:*`,
  creates `src/lib/mt5-redis-keys.ts`, removes the unused `stream:live`
  transport.
- `da4d09d` (2026-07-30) — "docs(mt5-native-bridge): fix Redis key hash-tags,
  add client connection contract" — fixes brace-literalness ambiguity,
  reorders keys to `{namespace}:{version}:{id}:{attribute}`, adds the
  single-pooled-connection-per-producer rule.
- `src/lib/mt5-redis-keys.ts:1-4` — "Canonical Redis key builders for the
  native bridge (`bridge/`) contract: `mt5:account:{login}:<resource>` —
  braces around login are a literal Redis Cluster hash tag... Mirror any
  change here in `cluster_keys()`."
- `bridge/redis_transport.py`'s `cluster_keys` (~lines 92-99) builds
  `mt5:account:{login}:lease`, `:lease-epoch`, `:fence-counter`, `:live`,
  `:stream:history` from one hash-tag slot, matching the Node-side builder.
- CLAUDE.md, Agent Workflow Notes: "It consumes the native bridge (`bridge/`)
  contract directly: `mt5:account:{login}:live` and
  `mt5:account:{login}:stream:history`."
