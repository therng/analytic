# Ingestion Review — worker-v2 equity-sampler excursion-prune batching (working-tree diff)

- status: **pass**
- reviewed scope: uncommitted working-tree diff on `src/worker-v2/equity-sampler.ts` (+33/-8) and `src/worker-v2/equity-sampler.test.ts` (+44), base commit `87f60d2` (branch `main`). Batches the `positionExcursion.deleteMany` OR-list into `EXCURSION_PRUNE_BATCH_SIZE = 10_000` pairs per call to stay under the Postgres 32,767 prepared-statement bind-parameter ceiling (Prisma P2035), plus tests.
- reviewer: bridge-ingestion-review skill (read-only)

## Findings

No blocking findings. Evidence per reviewed question:

1. **Batching semantics — correct.** `src/worker-v2/equity-sampler.ts:252-266`: the `offset` loop with `closed.slice(offset, offset + EXCURSION_PRUNE_BATCH_SIZE)` partitions `closed` into disjoint contiguous batches; every pair is deleted exactly once (test proves flattened order equals the `closed` mapping, `equity-sampler.test.ts:325-331`). Retry idempotency: each `deleteMany` is its own implicit transaction; `runEquitySamplerLoop` catches a mid-prune failure (`equity-sampler.ts:292-302`) and the next hourly pass recomputes `closed` deterministically (prune never deletes `Position` rows, so the source list is stable) — already-deleted pairs delete 0 rows. No partial-state coupling; `PositionExcursion` is a leaf table (no FK dependents).
2. **Retention semantics — unchanged.** Same `closed` query (`closeTime < cutoff`, `equity-sampler.ts:242-245`), same per-pair OR conditions; still-open positions (`closeTime` null) are excluded by `lt` semantics. Pre-existing test `equity-sampler.test.ts:284-296` still passes.
3. **Batch math — correct.** 2 binds per OR entry (tradingAccountId, positionTicket); 10,000 × 2 = 20,000 ≤ 32,767 with ~12.7k headroom. Max safe constant is 16,383; the test assertion `or.length * 2 <= 32_767` (`equity-sampler.test.ts:321`) trips if the constant is ever raised past that — a useful tripwire.
4. **Test fixture seam — sound.** `fixture.db.position.findMany = async () => closed` (`equity-sampler.test.ts:305`) reassigns a plain object-literal property, the same pattern as the pre-existing test (`equity-sampler.test.ts:286-288`); type-compatible with `EquitySamplerDb` (tsc clean for both files); the mock records every `deleteMany` arg so batch count, per-call ceiling, and exact no-drop/no-dup coverage are all asserted against real recorded calls.
5. **Rollout risk — low, one note.** No schema, migration, or Redis-contract change; deploy is the standard worker rebuild + `nssm restart analytic-worker`. Because P2035 fails at prepare time, zero excursion rows were pruned on the production host while the OR-list exceeded the ceiling — the first post-deploy prune will delete the accumulated backlog across multiple 10k-pair batches. Each batch is a separate transaction (no long-lived tx), so the effect is a bounded WAL/autovacuum spike and a possibly delayed next equity sample cycle; self-healing. No restart-ordering constraint.

Non-blocking observations (pre-existing, not required for this diff):

- `src/worker-v2/equity-sampler.ts:242-245` still loads every closed-position pair ever recorded into worker memory each hour, and the list never shrinks (`Position` rows are never deleted). This fix removes the hard P2035 failure but the hourly full-list `findMany` grows unboundedly; a future cursor-paginated or high-water-mark prune would bound it.
- `Position @@index([tradingAccountId, closeTime, positionNo])` (`prisma/schema.prisma:162`) has `tradingAccountId` as leading column, so the account-less `closeTime < cutoff` filter cannot use it efficiently — hourly seq scan on `Position`. Pre-existing; the batched `PositionExcursion` deletes can use the `@@unique([tradingAccountId, positionTicket, ts])` prefix (`prisma/schema.prisma:307`).
- Sibling audit: `equitySnapshot.deleteMany` (`equity-sampler.ts:240`, 1 bind) and `openPosition.deleteMany` in `src/worker-v2/live-sync.ts:185` (1 bind, per account) are safe; repo-wide grep found no other unbounded `OR: <list>.map` write in `src/`.

## Required action

None. Ship as-is. Optional follow-up (separate change): bound the hourly `closed` list growth noted above.

## Checks performed

- `git diff` review of both files; full read of `equity-sampler.ts`, `equity-sampler.test.ts`.
- `node --import tsx --test src/worker-v2/equity-sampler.test.ts` — 12/12 pass.
- `npx tsc --noEmit` — no errors in the changed files. 17 pre-existing errors exist at HEAD, all confined to `src/worker-v2/reconstruct-position-adapter.test.ts` (untouched by this diff; do not attribute them to this change at the release gate).
- Prisma schema audit of `Position` / `PositionExcursion` / `EquitySnapshot` indexes (no new index or migration in this diff).
- Secret scan of the diff: no credentials, no `.env*` additions, no literal replacing an env var.

## Missing evidence

- Not executed against a live PostgreSQL 18: the 20,000-bind statement shape is proven by math and the recorded-call unit tests, not against a real server. P2035 reproduction on prod is documented in the task context; the fix is deterministic on batch size.
- `python3 -m pytest -q bridge/tests` not run (no `bridge/` changes — not applicable to this diff).
