# Ingestion review — live-position UTC offset fix

**Scope:** `src/lib/time.ts`, `src/lib/redis-mt5.ts`, `src/worker-v2/mappers.ts` (+ matching tests).

## What changed

Added `liveEpochSecondsToDate` (subtracts `brokerUtcOffsetMinutes`) and pointed
the two MT5 *live*-endpoint call sites at it:

- `mapPositionToOpenPosition` (`src/worker-v2/mappers.ts`) — `OpenPosition.openTime`
- `normalizeMt5PositionTimes` (`src/lib/redis-mt5.ts`) — `/api/accounts/[id]/live` position times

`epochSecondsToDate` (Deal/Order/Position history mapping — `mapDealToPrisma`,
`mapOrderToPrisma`, `position-reconstructor.ts`) is unchanged: still a pure
pass-through, no offset applied.

## 1. Trace the envelope from MT5 epoch through Redis and worker persistence

Two distinct MT5 endpoints feed this pipeline with two distinct clock bases:

- **History** (`history_deals_get`/`history_orders_get` → bridge_v2 →
  Redis Streams → `deal-consumer.ts`/`order-consumer.ts` → `mapDealToPrisma`/
  `mapOrderToPrisma` → `Deal.time`/`Order.time*` → `position-reconstructor.ts`
  derives `Position.openTime`/`closeTime` from `Deal.time`).
- **Live** (`positions_get()` → bridge_v2 live publisher → Redis live hash/set
  → `live-sync.ts` → `mapPositionToOpenPosition` → `OpenPosition.openTime`;
  and the same live snapshot read back through `redis-mt5.ts` for the `/live`
  API route).

## 2. Verify raw MT5 epochs are never shifted by broker-server offset — AMENDED

The blanket rule in this skill's checklist ("never shift by broker offset")
is only correct for the **history** path. Verified against live production
data on 2026-07-29 (account 7998410 / 7954220, broker `ICMarketsSC-MT5-2`,
`brokerUtcOffsetMinutes=180`):

- **History path is correct as-is.** 10 fresh `Deal` rows: `time` vs. the
  row's own `imported_at` (Postgres `now()` at insert) showed a consistent
  **-73s** skew — deal recorded ~73s before ingest, i.e. true UTC. No
  correction needed; `epochSecondsToDate` stays a no-op by design.
- **Live path was wrong.** 10 fresh `OpenPosition` rows: `open_time` vs. the
  row's own `report_date` (bridge heartbeat epoch, true UTC at write) showed
  **+79 to +116 minutes** — positions appeared to open in the future.
  Subtracting the account's `brokerUtcOffsetMinutes` (180) reproduced the
  correct elapsed age to within a second on every sampled row (e.g. predicted
  `180 - age` vs. observed skew: 115.97 vs. 116.0, 93.97 vs. 93.97). Also
  cross-checked directly against MT5 via SSH: `symbol_info_tick()` on the
  live terminal read +10797–10799s (~3h) ahead of true system UTC, matching
  the configured offset — confirming the live feed's clock, not the history
  API's, is broker-local.

## 3. Missing history begins at 2025-01-01 — unaffected

Not touched by this change; no backfill/checkpoint logic modified.

## 4–7. Idempotency, checkpoints, Redis-as-mirror, restart/replay paths

Not touched. `OpenPosition` write path (`live-sync.ts::syncAccountLive`) is
unchanged aside from the timestamp value now written; upsert keys, gating on
`brokerUtcOffsetMinutes === null`, and the fingerprint-based no-op-on-unchanged
logic are untouched. `OpenPosition` is a fully-replaced snapshot per poll
(no durable/idempotent history semantics apply), so no backfill or migration
is required — the next live poll for each account self-corrects.

## 8. Worker cutover ownership

Unaffected — no ownership/ordering changes.

## 9. Migrations and rollout gates

No schema or migration changes. No `.env*`/secret literals introduced.

## 10. Indexing

No new or changed indexes.

## 11. Secret scan

Clean — no `REDIS_PASSWORD`/`DATABASE_URL`/`DUCKDNS_TOKEN`/credential literals
in the diff.

## Validation checklist

- [x] Replay idempotency: unaffected (no history-path change).
- [x] PostgreSQL durable authority: unaffected.
- [x] No FTP/manual-import path reintroduced.
- [x] Tests cover the changed behavior: `src/lib/time.test.ts` (new
      `liveEpochSecondsToDate` cases: UTC+3, UTC+0 pass-through, day-boundary
      crossing, DST-narrower UTC+2), `src/lib/redis-mt5.time.test.ts`,
      `src/worker-v2/mappers.test.ts` updated to assert the corrected value.
- [x] Full suite: `node --import tsx --test src/worker-v2/*.test.ts
      src/lib/time.test.ts` → 190 pass / 1 pre-existing skip / 0 fail.
- [x] `npx tsc --noEmit` clean.
- [x] `npm run lint` clean (one pre-existing unrelated warning in
      `balance-curve-24h.test.ts`, not touched by this change).
- [x] `npm run build` clean.
- [x] No secret/credential/.env file in diff.

**Verdict: pass.**

bridge-ingestion review: pass
