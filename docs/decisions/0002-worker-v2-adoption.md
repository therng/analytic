# ADR-0002: Consolidate Node ingestion under Worker V2, retire `src/worker/`

## Status

Accepted

## Date

2026-07-27

## Context

Through mid-2026-07 the repo ran two Node workers side by side:
`src/worker/` (the original runtime, sole owner of `equity-sampler.ts` and
`economic-events-poller.ts`) and `src/worker-v2/` (durable Deal/Order/Position
ingestion, built on Package 3A/3b/4 checkpoint work). CLAUDE.md at the time
stated explicitly: "Worker migration in progress: `src/worker/` and
`src/worker-v2/` both run live in `docker-compose.yml`... `src/worker/` is not
legacy/removable until [equity sampling and economic events] are ported."
Running two workers meant two deploy targets, two health surfaces, and two
places a Redis/Postgres contract change had to land correctly.

## Decision

Port `equity-sampler.ts` and `economic-events-poller.ts` into `src/worker-v2/`,
delete `src/worker/` (`bridge-accounts.ts`, `bridge-consumer.ts`,
`bridge-mapper.ts`, `bridge-protocol.ts`, and its own copies of the sampler/
poller), and remove its `docker-compose.yml` service. Worker V2 becomes the
sole active Node worker, owning account provisioning, durable Deal/Order/
Position ingestion, `AccountSnapshot`/`OpenPosition`, `EquitySnapshot`/
`PositionExcursion`, and economic events — plus component health and a
resilient loop lifecycle, released as v8.5.

## Alternatives Considered

### Keep both workers running indefinitely, split by domain

- Pros: no big-bang cutover, `src/worker/` code already proven for equity/
  calendar.
- Cons: every Redis/Postgres contract change (e.g. the later native-bridge
  migration) would need coordinating across two runtimes; two health
  endpoints, two restart policies, two places a bug can hide.
- Rejected: the dual-worker state was explicitly framed in CLAUDE.md as
  transitional ("in progress"), not a target architecture.

### Rewrite `src/worker/` in place instead of consolidating into `worker-v2`

- Pros: avoids restructuring code that already had Package 3A/3b/4 durable-
  history work landed on it.
- Cons: `worker-v2` was already the durable-ingestion owner and had the
  checkpoint/health infrastructure; moving the smaller sampler/poller
  surfaces into it was the smaller migration.
- Rejected in favor of porting the smaller pieces forward.

## Consequences

- Single deploy target, single health endpoint (`:9200`) for all ingestion
  components (`deals`, `orders`, `live`, `equity`, `calendar`).
- CLAUDE.md's Agent Workflow Notes now state plainly: "Worker V2 is the sole
  active Node worker... The retired `src/worker/` runtime and Compose service
  must not be reintroduced."
- `src/worker-v3/` exists only as scaffolding (`aggregations/`, `mappers/`,
  `processors/`, `validators/`) for a future migration phase — no
  docker-compose service or npm script — and is not to be treated as an
  active runtime.
- A later contract change (migrating off the retired `bridge_v2`'s `mt5n:v1`
  keys onto the native bridge's `mt5:account:{login}:*` contract) only had to
  land in one place — `src/worker-v2/`.

## Evidence

- `24daefb` / `fc94042` (2026-07-27) — "refactor: consolidate pipeline into
  worker v2" — deletes `src/worker/bridge-accounts.ts`,
  `bridge-consumer.ts`, `bridge-mapper.ts`, `bridge-protocol.ts`,
  `economic-events-poller.ts`, `equity-sampler.ts`; adds component health and
  loop lifecycle; releases v8.5.
- CLAUDE.md, pre-`fc94042` (as of `3020954`, 2026-07-27): "Worker migration in
  progress: `src/worker/` and `src/worker-v2/` both run live in
  `docker-compose.yml`... neither ported yet, so `src/worker/` is not
  legacy/removable until they are."
- CLAUDE.md, current (root `CLAUDE.md`, Agent Workflow Notes): "Worker V2 is
  the sole active Node worker... The retired `src/worker/` runtime and
  Compose service must not be reintroduced. `src/worker-v3/` remains
  scaffolding only."
- `8f070ca` (2026-08-01) — "fix(worker): migrate worker-v2 from retired
  bridge_v2 to native mt5n:v1 bridge" — confirms `worker-v2` as the single
  place later contract migrations land.
