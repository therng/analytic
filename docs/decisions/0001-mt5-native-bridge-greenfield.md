# ADR-0001: Build mt5_bridge_native as a separate greenfield package

## Status

Accepted

## Date

2026-07-30

## Context

`bridge_v2` is part of the active production ingestion path
(`MT5 API → Python Bridge → Redis Streams → Worker V2 → PostgreSQL`, see
root `CLAUDE.md`) and must remain untouched and running while a new bridge
design is developed and proven. `ARCHITECTURE.md` in this directory
specifies a bridge with materially different guarantees than `bridge_v2`
provides today:

- SQLite-authoritative checkpointing and a transactional outbox, instead of
  Redis-mirrored progress state.
- Fenced, epoch-based distributed ownership instead of best-effort locking.
- Deterministic replay and versioned corrections for history records.
- Fail-closed terminal attachment with explicit process/identity preflight
  and quarantine on any drift.

## Decision

Build the new bridge as an isolated package, `mt5_bridge_native/`, that does
not import, wrap, adapt, or modify any file belonging to `bridge`, `bridge_v2`,
or worker-v2. Development, testing, and fault injection happen entirely
against this new package. Production cutover is a separate, later decision
gated on the acceptance criteria in `IMPLEMENTATION_PLAN.md` Task 13.

## Alternatives Considered

### Extend bridge_v2 in place

- Pros: single codebase, no dual-maintenance window, incremental rollout.
- Cons: SQLite-authoritative checkpointing, fenced ownership, and fail-closed
  attach are core behavioral changes, not additive features — retrofitting
  them means rewriting `bridge_v2`'s checkpoint, ownership, and terminal
  connection logic while it is live in production.
- Rejected: the rewrite-in-place blast radius is the current production
  ingestion path itself; a regression there is a live-trading-data outage,
  not a contained failure.

### Rewrite bridge_v2 on a maintenance branch, cut over in one release

- Pros: avoids two bridges coexisting even temporarily.
- Cons: still requires a full core rewrite before any of it can be verified
  against real terminals; the entire new design would be unvalidated until
  the single cutover moment.
- Rejected: removes the ability to test, verify, and fault-inject the new
  guarantees independently before they touch production data.

### Greenfield package, isolated development and validation (chosen)

- Pros: `bridge_v2` stays untouched and running throughout; the new bridge
  can be built, tested, and fault-injected (Task 13) with zero effect on the
  production path; cutover becomes an explicit, separately-approved step.
- Cons: two bridges exist in the repository during validation; requires
  explicit isolation rules to prevent accidental interference.

## Consequences

- `ARCHITECTURE.md` §0 and `IMPLEMENTATION_PLAN.md`'s global constraints
  encode the isolation requirement: no existing bridge file is read,
  imported, or modified by `mt5_bridge_native`.
- Both bridges may exist in the repository during validation, but they must
  never publish to the same Redis namespace or hold ownership of the same
  login concurrently. `mt5_bridge_native` uses the disjoint `mt5n:v1:*`
  namespace (`ARCHITECTURE.md` §10) specifically to make this enforceable.
- Cutover happens only after `mt5_bridge_native` passes every acceptance
  gate in `IMPLEMENTATION_PLAN.md` Task 13, and only under an explicit,
  separately written and approved migration plan — no such plan exists yet
  and none of the work in this ADR authorizes writing one.
- Rollback strategy: because `bridge_v2` is never modified or stopped during
  `mt5_bridge_native` development, rollback during validation is a no-op —
  disable/remove the new producer, production ingestion is unaffected.
  Rollback *after* cutover is out of scope for this ADR and must be defined
  in the migration plan required above.
- Retirement of `bridge_v2` is a separate, later cleanup phase, only after
  cutover has stabilized in production. This ADR does not schedule or
  authorize that retirement.
- Until cutover, the two packages are dual-maintained in the sense that both
  exist in the repo, but only one (`bridge_v2`) is operationally live —
  there is no dual-write or dual-read production burden during this phase.
