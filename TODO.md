# TODO

## Known issues

- [ ] `prisma/schema.prisma`'s `BridgeHistoryRecord.chunkId` field has no `@map`, but the
      already-applied migration `20260713120000_add_bridge_history_checkpoints` created the
      actual PostgreSQL column as `chunk_id` (snake_case), not `chunkId`. Prisma's naming
      convention would normally auto-map `chunkId` -> `chunk_id`, so this may already work at
      runtime — but `prisma migrate dev`'s schema diff sees it as drift and will bundle a
      destructive `DROP COLUMN "chunk_id" / ADD COLUMN "chunkId"` (rewriting the PK/FK on
      `BridgeHistoryRecord`) into the next unrelated migration unless reconciled first. Fix by
      either adding an explicit `@map("chunk_id")` to the schema field (if that's the intended
      column name) or writing a corrective migration that renames the column to match the
      schema's implicit name — confirm which is correct against the live DB column name before
      choosing.

## MT5 historical data rebuild (planned)

Historical Deal/Order/Position/ClosedPosition data predates `brokerUtcOffsetMinutes` and is
incomplete (old missing-cursor fallback only imported the most recent 30 days). Approved
recovery is a clean rebuild from MT5, not an in-place timestamp correction — do not reintroduce
a bulk offset-shift migration or a `TradingAccount` migration-marker column.

- [ ] Configure `brokerUtcOffsetMinutes` for every account (`scripts/set-broker-utc-offset.ts`)
- [ ] Create a database backup
- [ ] Delete existing MT5-derived historical/runtime records
- [ ] Clear history cursors, backfill state, streams, dedupe state, and derived caches
- [ ] Run automatic full backfill from 2000-01-01
- [ ] Verify newly imported timestamps persist as UTC
- [ ] Verify monthly counts, gaps, duplicates, and timezone correctness post-rebuild

## Bridge cutover (active)

Spec: `docs/superpowers/specs/2026-07-02-bridge-ftp-migration-design.md`
Plan: `docs/superpowers/plans/2026-07-02-bridge-ftp-migration.md`

Tasks 1-10 of the plan are implemented and merged to `main` (schema, `bridge/tracking.py`,
history sync, close-detection events, `bridge-mapper.ts`, `bridge-consumer.ts`,
AccountSnapshot/OpenPosition sync, validation scripts, and docs). The worker now runs in
Bridge/Redis-only mode.

- [x] Monitor bridge stream ingestion and worker health across all accounts —
      verified 2026-07-12: `GET /api/accounts` on prod shows all 4 accounts with
      `last_updated` within seconds of request time, `/api/health` returns `ok`
- [x] Flip `bridge-consumer.ts` target models from `bridgeDeal`/`bridgeOrder`/`bridgePosition`
      to the real `deal`/`order`/`position` tables
- [x] Remove the remote report import path from the continuous worker and Docker config
- [x] Monitor one full week post-cutover — bridge-only mode shipped 2026-07-02/04
      (`bridge-only-runtime.test.ts`, no FTP refs left in `src/worker/` or
      `docker-compose.yml`); 8-10 days elapsed as of 2026-07-12 with healthy live
      ingestion confirmed above
- [x] Remove HTML parser/manual local backfill path permanently
- [x] Remove the `Bridge*` shadow tables when no longer needed — confirmed absent from
      `prisma/schema.prisma` and no remaining code references

## Housekeeping

- [x] Untracked `.agents/`, `.codex/agents/`, `.codex/hooks.json`, `.codex/hooks/`, `Modelfile`
      at repo root — local AI-agent tooling, not project source; gitignored alongside `.gemini/`
- [x] Local `main` is 1 commit ahead of `origin/main` (bridge cutover work) — pushed
