# Ingestion Review — live-sync liveness touch

- status: pass
- reviewed scope: `src/worker-v2/live-sync.ts`, `src/worker-v2/live-sync.test.ts`
- commits: e5cd464 (fix: keep live accounts from silently vanishing from the dashboard), 36d00b4 (refactor: extract AccountLiveSyncState)

## Findings

- Adds a 10-minute-throttled `prisma.tradingAccount.update({ data: { updatedAt: new Date() } })` driven by heartbeat presence, independent of whether the live/position fingerprint changed.
- Throttle state (`lastTouchedAt`) is in-memory per worker process, not persisted — a worker restart at worst causes one extra immediate touch. No double-write or corruption risk since the write is a plain timestamp set, not a counter or checkpoint mutation.
- Does not touch `Deal`/`Order`/`Position`, `BridgeHistoryCheckpoint`/`Chunk`/`Record`, or any Redis stream/ack contract — out of scope for durable history checkpoint rules.
- No UTC/broker-offset handling involved; writes local server time via `new Date()`.
- Tests added alongside the change (`live-sync.test.ts`, +61 lines).

## Required action

None. Pass.
