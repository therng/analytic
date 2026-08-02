---
name: bridge-ingestion-review
description: Review MT5 Bridge, Redis stream, worker, Prisma persistence, and durable history changes for UTC correctness, idempotency, checkpoint safety, and rollout risk. Use when changes touch bridge/, src/worker*, Redis contracts, history recovery, or ingestion-related schema and migrations.
---

# Bridge Ingestion Review

## When to Use

- Review changes in `bridge/`, `src/worker/`, `src/worker-v2/`, `src/worker-v3/`, ingestion scripts, or related Prisma models.
- Use for Redis key/stream contracts, history barriers, digests, acknowledgements, replay, and worker migration.
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
4. Check idempotency keys and uniqueness for deals, orders, positions, barriers, and acknowledgements.
5. Prove checkpoints advance only after all expected barriers, counts, digests, and durable PostgreSQL writes commit.
6. Confirm Redis acknowledgement state is a derived mirror, not the authoritative checkpoint.
7. Review restart, duplicate delivery, partial chunk, empty window, Redis loss, and out-of-order paths.
8. Check worker cutover ownership so legacy-only live sampling or calendar work is not removed accidentally.
9. Review migrations and rollout gates for backward compatibility, rollback, and shared-environment risk.
10. For new or changed indexes, apply `opinionated-prisma:indexing` — confirm high-cardinality/filtered lookups (checkpoint lookups, digest/barrier scans, `Deal`/`Order`/`Position` history queries) have a matching index, prefer partial/composite indexes over broad ones, and flag any migration adding an index on a large existing table without `CREATE INDEX CONCURRENTLY` guidance from `opinionated-prisma:migration-safety`.
11. Scan the diff for hardcoded secrets: `REDIS_PASSWORD`, `DATABASE_URL` credentials, `DUCKDNS_TOKEN`, broker/API keys, or any literal replacing an env var read. A committed `.env*` file (other than `.env.test.example`) or a credential-shaped string literal is a `fix`, not a style note.

## Outputs

Return `pass`, `fix`, or `blocked`, with file/line evidence and the failure mode for every issue. For durable handoff, write `_workspace/02_review_ingestion.md`.

## Validation

- Replay is idempotent and cannot skip or prematurely acknowledge history.
- PostgreSQL is the durable authority for history progress.
- No FTP, HTML report, manual import, or file-hash path is reintroduced.
- Tests cover at least one restart, duplicate, partial, or mismatch condition relevant to the change.
- Unavailable integration checks are reported explicitly.
- New or modified indexes match an actual query path and follow `opinionated-prisma:indexing` guidance; migrations on large tables follow `opinionated-prisma:migration-safety`.
- No secret, credential, or `.env*` file (other than `.env.test.example`) is present in the diff.
