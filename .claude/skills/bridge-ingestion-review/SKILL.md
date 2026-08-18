---
name: bridge-ingestion-review
description: "Use when changes touch bridge/, src/worker-v2/, Redis key/stream contracts, SQLite history ownership, outbox publication, replay, manual recovery, scripts/set-broker-utc-offset.ts, or ingestion-related Prisma schema and migrations."
version: 1.1.0
---

# Bridge Ingestion Review

## When to Use

- Review changes in `bridge/`, `src/worker-v2/`, `scripts/set-broker-utc-offset.ts`, the Redis MT5 envelope under `src/lib/` (`redis-mt5*`, `mt5-redis-keys*`), or related Prisma models.
- Use for Redis key/stream contracts, SQLite history ownership, outbox publication, replay, and manual recovery paths.
- Treat `src/worker-v3/` as scaffolding only. Do not treat it, retired `src/worker/`, or legacy checkpoint tooling as a runtime owner.
- Do not use for dashboard-only reads of an unchanged API contract.

## Required Inputs

- Original request, changed diff, and focused tests.
- Current worker ownership and rollout notes in `CLAUDE.md`.
- History lifecycle and security rules in `AGENTS.md`.
- Relevant Redis protocol types and Prisma schema/migration.

## Workflow

1. Trace the envelope from MT5 epoch through Redis and worker persistence.
2. Verify raw MT5 UTC epochs are never shifted by broker-server offset.
3. Verify missing history begins at `2025-01-01`, not epoch or a rolling fallback.
4. Verify idempotency keys and database uniqueness for `Deal`, `Order`, and reconstructed closed `Position` records.
5. Prove the bridge SQLite journal, not Redis or PostgreSQL, owns history coverage, checkpoints, outbox obligations, and successful-publication state. Confirm journal recovery is guarded and fail-closed before MT5 or Redis side effects.
6. Confirm Worker V2 persists `history.deal` and `history.order` idempotently, reconstructs `Position`, and converts a broker-server epoch to UTC exactly once. Treat `history.window` as an audit marker with no checkpoint-advancing effect.
7. Verify the native contracts remain `mt5:account:{login}:live` and `mt5:account:{login}:stream:history`; check live-key TTL behavior, and ensure Redis stream ACKs and legacy history-ACK state never become durable progress.
8. Review restart, duplicate ownership, duplicate delivery, partial window, successful-empty window, Redis loss, and out-of-order paths.
9. Keep `BridgeHistoryCheckpoint`, legacy Redis history ACK references, and `src/worker-v2/history-checkpoint.ts` scoped to manual recovery only; do not reintroduce them into the normal native lifecycle.
10. Review Prisma schema, migrations, and actual query paths directly. Require each new index to support an identified filtered or ordered query, and flag unsafe large-table index creation without a rollout plan.
11. Scan the diff for hardcoded secrets: `REDIS_PASSWORD`, `DATABASE_URL` credentials, `DUCKDNS_TOKEN`, broker/API keys, or any literal replacing an env var read. A committed `.env*` file (other than `.env.example` and `.env.test.example`) or a credential-shaped string literal is a `fix`, not a style note.

## Outputs

Return `pass`, `fix`, or `blocked` per the review-artifact contract in `docs/harness/analytic/team-spec.md` (status, reviewed scope/commit identity, findings with file/line evidence, required action, checks performed). For durable handoff, write `_workspace/02_review_ingestion.md`.

## Validation

- Replay is idempotent and cannot skip or prematurely acknowledge history.
- The SQLite journal is the durable authority for native history progress; PostgreSQL is idempotent event persistence.
- No FTP, HTML report, manual import, or file-hash path is reintroduced.
- Tests cover at least one restart, duplicate, partial, or mismatch condition relevant to the change.
- Unavailable integration checks are reported explicitly.
- Index, migration, and secret audit complete per Workflow steps 10-11: every new index maps to a real query path, large-table migrations have a rollout plan, and no secret or stray `.env*` file (beyond `.env.example`/`.env.test.example`) is in the diff.
