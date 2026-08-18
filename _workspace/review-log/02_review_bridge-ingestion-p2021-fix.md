# Bridge Ingestion Review: worker-v2 P2021 boot-race fix (waitForSchemaReady thunk)

**Status: pass**

**Reviewed scope:** Uncommitted local diff (working tree, not yet committed) on top of
`17837cc9f1e9a4d8e7710c79bfd6b80c76e10aea` (main, 2026-08-07), limited to:
- `src/worker-v2/index.ts`
- `src/worker-v2/account-registry.ts`
- `src/worker-v2/history-consumer.ts`
- `src/worker-v2/index.test.ts`

Excluded per task instruction (unrelated in-flight work): `docs/harness/analytic/team-spec.md`,
`_workspace/02_review_ingestion.md`, `docs/decisions/0006-history-quarantine-decoupled-deal-commit.md`.

## Summary of change

`waitForSchemaReady` (`src/worker-v2/index.ts`) is generalized from
`(provisionAccounts: () => Promise<unknown>) => Promise<void>` to
`<T>(fn: () => Promise<T>) => Promise<T>`, exported, and `main()` now wraps
`provisionAccounts()` followed by `loadAccountRegistry(prisma)` as one retried thunk, closing the
gap where a fresh-migration boot could hit an unguarded P2021 on the registry load right after a
successful `provisionAccounts()` call. Also added: an empty-registry startup warning, a 0<->N
registry-size transition logger in `account-registry.ts`, a per-account consumer-start log in
`history-consumer.ts`, and two regression tests in `index.test.ts`.

## Primary question: is retrying the combined thunk safe after a partial success?

**Answer: yes, safe.** Traced both calls inside the retried thunk:

- `provisionAccounts()` → `ensureBridgeAccounts()` (`src/worker-v2/bridge-accounts.ts:67-87`)
  writes via `db.tradingAccount.upsert({ where: { accountNo }, update: {...}, create: {...} })`
  keyed on the natural key `accountNo` — not a plain `create`. Re-running it for the same set of
  accounts after a prior successful pass is a no-op-equivalent update, not a duplicate insert.
  There is no unique-constraint exposure on retry.
- `loadAccountRegistry()` (`src/worker-v2/account-registry.ts:6-15`) is a pure read
  (`prisma.tradingAccount.findMany()`) with no side effects.

So the failure mode described in the sharp question — `provisionAccounts()` succeeds, the
registry load then throws P2021, and the retry loop re-invokes `provisionAccounts()` and hits a
unique-constraint error instead of succeeding — does not occur here, because the write path is
idempotent-by-natural-key rather than a plain create. The code comment added in `index.ts:73-79`
claiming "Both calls are idempotent (upsert + findMany)" is accurate against the actual
implementation, not just an assertion.

Retrying the *whole* thunk (not just the failing call) is the correct fix shape given
`ensureBridgeAccounts` has no natural split point that would let you retry only the second call
without re-deriving Redis account state — and re-deriving that state on each retry is itself
harmless (same upsert-by-accountNo property).

## Other checks

- **UTC correctness:** unaffected. No `time.ts` change, no changes to timestamp handling; the
  only date field touched (`reportDate` inside `ensureBridgeAccounts`) is pre-existing code, not
  part of this diff.
- **SQLite-journal ownership boundary:** untouched. `history-consumer.ts` diff adds only a log
  line before `active.add(login)`/`redis.duplicate()` — no write path change. The file's existing
  header comment ("tracked entirely on the bridge side (its own SQLite journal + outbox/ACK)")
  is unchanged and the diff does not add any `BridgeHistoryCheckpoint`/`BridgeHistoryChunk`/
  `BridgeHistoryRecord` reads or writes. Worker V2 remains a pure consumer of
  `mt5:account:{login}:live` / `mt5:account:{login}:stream:history`.
- **Rollout risk of retrying a compound thunk:** low. `SCHEMA_WAIT_MAX_MS` bound (unchanged) still
  caps total retry time; a genuine non-P2021 error from either call still fails fast
  (`isMissingTableError` gate unchanged, confirmed by the "rethrows non-P2021 errors immediately"
  test). Retry backoff (500ms → doubling, unchanged) means at most a handful of redundant
  `ensureBridgeAccounts` passes during the narrow migration-race window — each pass does one
  Redis SCAN + N per-account upserts, negligible cost for a boot-time-only path.
- **Empty-registry log** (`index.ts:116-120`) is a `console.warn`, self-heal note is accurate:
  `runAccountRegistryRefreshLoop` (account-registry.ts) does pick the registry up on the next
  cycle once Redis has live keys, and now explicitly logs the 0→N transition
  (`account-registry.ts:47-52`) — consistent with the warning's claim.
- **Regression tests** (`index.test.ts:24-63`) directly exercise the fixed behavior: attempt-3
  success confirms the thunk is retried as a whole (not just first call), and a distinct test
  confirms non-P2021 errors still fail fast on the first attempt. Both assertions match the
  exported `waitForSchemaReady<T>` signature.

## Checks performed

- `git diff -- src/worker-v2/index.ts src/worker-v2/account-registry.ts src/worker-v2/history-consumer.ts src/worker-v2/index.test.ts` — read in full.
- Read `src/worker-v2/bridge-accounts.ts` (`ensureBridgeAccounts`) to verify upsert-by-natural-key, not plain create.
- Read `src/worker-v2/account-registry.ts` (`loadAccountRegistry`) to verify pure-read (`findMany`), no side effects.
- Reproduced: `node --import tsx --test src/worker-v2/index.test.ts src/worker-v2/account-registry.test.ts src/worker-v2/history-consumer.test.ts` — 20/20 pass, including both new regression tests.
- `npx eslint` on the four reviewed files — clean, no output.
- `npx tsc --noEmit` — pre-existing errors present in `src/worker-v2/reconstruct-position-adapter.test.ts` (unrelated file, not part of this diff, out of scope — confirmed via `git diff --stat` that file is untouched by this change).
- Confirmed via grep that `history-consumer.ts` diff does not touch `BridgeHistoryCheckpoint`/`BridgeHistoryChunk`/`BridgeHistoryRecord` or any SQLite-journal read/write path.

## Required action

None. No fixes required for this diff.

## Findings

None blocking. No file/line issues found in the reviewed scope.
