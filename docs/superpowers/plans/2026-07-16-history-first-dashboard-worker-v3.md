# History-First Dashboard and Worker V3 Recovery Plan

**Status banner:** Adopted 2026-07-16. Autonomous scope: preflight (Package 1) + Package 2 app code, gated on the index-existence check below. Everything else (Package 3 onward: migrations, Bridge V2 durable replay, gated rollout, Worker V3 start, commit/push) requires explicit user approval per the gates this document defines below — "approved" does not collapse those gates.

## Summary

Goal: every configured account has continuous PostgreSQL Deal, Order, and canonical Position history from 2000-01-01 through current frozen rollout watermark.

Sequence: fix dashboard query path → add durable Bridge V2 recovery → prove full coverage → start Worker V3 P2.

Use additive replay. Preserve existing business rows. No database wipe, guessed cursor, Redis reset, or production rollout without explicit approval.

Add current-status banners to three existing dashboard/Worker V3 documents.

## Contracts and Interfaces

- Keep existing `mt5:v2` live keys unchanged.
- Upgrade Deal/Order stream envelopes with protocol version, account-scoped chunk ID, parent checkpoint, half-open `[start,end)` window, ordinal, expected count, event key, and canonical SHA-256.
- Default maximum window: 30 days. Compare `history_*_total` with fetched rows and repeat query before publishing. Split mismatched windows down to one hour; block account if mismatch remains.
- Emit barriers on existing Deal and Order streams. Bridge advances producer cursor only after PostgreSQL-derived `mt5:v2:history:{login}:ack` confirms commit.
- Reuse `BridgeHistoryCheckpoint`, `BridgeHistoryChunk`, and `BridgeHistoryRecord`. **Hard STOP before reuse:** verify live schema, migration provenance, `chunk_id` column mapping (see CLAUDE.md Known Follow-up), and exclusive checkpoint ownership (no active legacy writer).
- Add only `WorkerMessageFailure` through repository migration workflow. Store stream ID, account/chunk when known, payload, error code, attempts, timestamps, and resolution status.
- Add `GET /api/accounts/[id]/trade-history`:
  - Indexed keyset ordering: `closeTime DESC, positionNo DESC`, scoped by `accountId` — supporting index must lead with `accountId` (e.g. `(accountId, closeTime DESC, positionNo DESC)`). **Confirm index exists before deciding if Package 2 is migration-free.**
  - Default limit 150; maximum 250; fetch limit + 1.
  - Return rows, exact total, opaque cursor metadata, and PostgreSQL sync state.
  - Invalid cursor → 400; missing account → 404; database failure → existing sanitized API error contract.
- Replace full-row Heatmap and BotPnL requests with bounded server aggregation and paginated detail responses.

## Implementation Packages

### Package 1 — Current-state and safety preflight (autonomous, read-only) — COMPLETE 2026-07-16

- Preserve untracked `.claude-english-buddy.json`. Done — untouched.
- Migration status: `npx prisma migrate status` → up to date, 21 migrations applied, no drift.
- `chunk_id` mapping verified: live `"BridgeHistoryRecord"."chunk_id"` is `text NOT NULL`, matches `schema.prisma` `chunkId String @map("chunk_id")` exactly. No mismatch — Known Follow-up in CLAUDE.md resolved as safe.
- Legacy-writer collision check: `grep -rl "BridgeHistoryCheckpoint\|BridgeHistoryChunk\|BridgeHistoryRecord" src/ --include="*.ts"` (excluding tests) → **zero results**. No application code writes to these tables yet — no collision risk. Live data: 4 `BridgeHistoryCheckpoint` rows (`phase=backfill`, `last_completed_chunk_id=null`, `backfill_completed_at=null` — untouched/fresh), 0 rows in `BridgeHistoryChunk`/`BridgeHistoryRecord`.
- Keyset index check: `Position_account_id_close_time_position_no_idx` on `(account_id, close_time, position_no)` **already exists** in the live database — leads with `account_id` as required. Package 2's trade-history endpoint is **migration-free**.
- Document contradictions fixed: banners added to `docs/dashboard-data-flow-repair.md`, `docs/worker-v3-redis-contract.md`, `docs/worker-v3-implementation-plan.md`.
- **Result: no STOP triggered.** Package 2 proceeds autonomously. Package 3+ remain gated on user approval per this plan regardless.

### Package 2 — Database-level dashboard history (autonomous app code, gated only if migration needed)

- Create focused history query instead of calling `getAccountBundle(...allHistory)`.
- Enrich only page Position IDs from indexed Deal/Order queries — batch via single `WHERE positionNo IN (...)`, not per-row.
- Restore TradeHistoryPanel HTTP-status checks, 12-second abort, superseded-request cancellation, retry, cursor dedupe, skeleton, and distinct empty/syncing/blocked/query-error states.
- Keep `/positions?history=0` for summary/open-position data.
- Ensure all-history metrics use PostgreSQL aggregates, not loaded pages.

### Package 3 — Durable Worker V2 ingestion (gated: requires Package 1 STOP resolution + user approval)

- Persist canonical upsert and chunk receipt in one transaction; XACK only afterward.
- Canonical reconstruction version 1 loads all persisted deals for each touched position and sorts by `(time, ticket)`.
- Include zero-volume commission/swap/fee deals; support partial closes, multiple fills, cross-window positions, and inout reversals.
- Missing price/symbol, unknown trade direction, or reopen-after-flat becomes unresolved `WorkerMessageFailure`; never emit a guessed Position.
- Store derived Position count/digest and reconstruction algorithm version before checkpoint advancement.
- Duplicate replay is a no-op; ordinal gap, digest change, stale parent, or checkpoint regression remains pending and blocks only that account.

### Package 4 — Bridge V2 acknowledged replay (gated: user approval required)

- Durable mode defaults off.
- When enabled, ignore unconfirmed producer cursor and begin from validated PostgreSQL ACK mirror.
- Publish one verified window, then wait for durable ACK before planning next.
- Empty windows still publish zero-count barriers.
- Freeze per-account target watermark at rollout start. Backfill passes when checkpoint reaches that watermark; incremental health then requires lag within two history-sync intervals.

### Package 5 — Gated rollout (gated: user approval required, production/VPS execution)

- Verify PostgreSQL backup by restoring it into isolated database.
- Confirm `brokerUtcOffsetMinutes` for every account.
- Deploy compatible Worker V2 first, Bridge V2 second, both with durable mode off.
- Enable one account at a time. Other accounts and live publishing continue.
- After backfill, independently re-query every source window and compare ticket/payload digests with committed receipts.
- Stop account on source-total mismatch, poison record, missing offset, checkpoint inconsistency, database failure, or unexplained canonical Position difference.
- Rollback order: disable producer durable mode, stop new windows, let upgraded worker drain safe entries, then roll back bridge/worker. Preserve checkpoints and business rows.
- Suspected corrupt upserts require separate approved restore runbook using verified pre-replay backup; kill switch alone is not considered rollback.

### Package 6 — Worker V3 gate (gated: user approval required, only after all accounts pass coverage)

- Start broad P2 schema only after all accounts pass coverage.
- V3 reuses canonical PostgreSQL history and durable coverage ledger.
- Future `WorkerConsumerState` tracks V3 runtime stream offsets only; it must not become competing coverage authority.

## Test and Acceptance Plan

- Bridge tests: 2000 start, `[start,end)` boundaries, total/get comparison, recursive splitting, empty window, duplicate replay, partial Redis publication, malformed/stale ACK, and no cursor advancement before ACK.
- Worker tests: atomic receipt/upsert, duplicate/gapped ordinal, barrier arrival in either order, cross-window reconstruction, partial close/reversal, zero-volume fees, poison persistence, account isolation, and exact-decimal calculations.
- Crash tests: PostgreSQL commit before XACK. Checkpoint commit before Redis mirror. Mirror publication before producer advancement. Concurrent consumers, Redis loss/trim, stale mirror regeneration, replay/live overlap, and timezone boundary cases.
- API/UI tests: tied timestamps, invalid cursors, more than 10,000 trades, bounded page/enrichment reads, aggregate query strategy, abort/retry/dedupe, syncing/blocked/empty/error states, portrait and landscape.
- Use EXPLAIN plus query instrumentation to prove page queries fetch at most limit + 1 Position rows and enrichment only touches returned IDs.
- Repair `scripts/verify-history-backfill.ts`: typed Prisma access, per-month matrix, expected/applied counts and digests, frozen watermark, checkpoint/mirror comparison, unresolved-failure reporting, nonzero failure exit, and Redis disconnect.
- Required checks: Prisma validate/generate, migration SQL review, focused bridge/worker/API/UI tests, lint, TypeScript, worker builds, production build.

Acceptance requires every configured account to have:

- Coverage starting exactly 2000-01-01; pre-retention periods represented by verified empty windows.
- Checkpoint `phase=incremental`, non-null `backfillCompletedAt`, and completed-through at or beyond frozen watermark.
- Complete chunk ledger with matching Deal, Order, and derived Position counts/digests.
- Independent MT5 re-query agreement and zero unresolved `WorkerMessageFailure` rows.
- Redis ACK mirror equal to PostgreSQL checkpoint.
- Dashboard traversal beyond 10,000 trades without full-history row materialization.

## Assumptions

- Audience: implementation agent.
- Existing PostgreSQL/Redis deployment remains in use; no new Prisma Postgres provisioning.
- Production/VPS execution needs explicit approval. Commit/push also remains unauthorized; push requires repository version-bump confirmation.
- Drawdown semantics and stale-account visibility remain separate dashboard work.
