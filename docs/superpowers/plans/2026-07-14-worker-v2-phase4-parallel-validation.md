# Worker V2 Phase 4 — Parallel Deployment & Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the full `Bridge V2 → Redis streams → Worker V2 → PostgreSQL → API/Dashboard` pipeline is healthy, idempotent, and crash-safe while running alongside the legacy worker in production, without replacing or deleting anything legacy.

**Architecture:** Worker V2 already runs as its own `docker-compose` service (`worker-v2`, commit `ac17197`) beside the legacy `worker` service, both pointed at the same `db`/`redis`. This phase adds one missing safety control — a runtime toggle to disable Worker V2's live-state writes (`AccountSnapshot`/`OpenPosition`) — then executes a scripted validation pass against the already-running stack and produces a completion report.

**Tech Stack:** Docker Compose, Node.js/TypeScript (`src/worker-v2/`), Redis Streams (`redis-cli`), PostgreSQL (`psql`/Prisma), `node:test`.

## Global Constraints

- Do not replace, stop permanently, or delete the legacy `worker` service or any code under `src/worker/**`.
- Do not modify Bridge V2 (`bridge_v2/**`).
- Do not change Redis stream contracts, Prisma schema, or run any migration.
- Do not wipe Redis or PostgreSQL data, and do not reset any consumer group.
- No UI refactoring, no historical data rebuild, no removal of any existing service.
- Financial values: unchanged — no code in this phase touches Decimal/mapper logic.
- English only in source, comments, tests, logs, and commit messages.
- Do not invent configuration where a safe mechanism already exists; the one new env var in Task 1 is added only because no such toggle exists today (confirmed by inspection).
- `git reset --hard`, `git clean`, `git stash` are not authorized during this plan.

---

## Current State (confirmed by inspection, 2026-07-14)

- Worker V2 source is merged to `main`; its 9 unit-test files pass per the `2026-07-14-worker-v2-redis-to-postgres.md` plan's Task 11.
- `docker-compose.yml` **already** defines `worker-v2` (commit `ac17197 chore: deploy Worker V2 service`), with `WORKER_V2_HEALTH_PORT` (default `9200`), `WORKER_V2_BATCH_SIZE`, `WORKER_V2_BLOCK_MS`, `WORKER_V2_IDLE_RECLAIM_MS`, `WORKER_V2_LIVE_SYNC_INTERVAL_MS`, `WORKER_V2_ACCOUNT_REFRESH_MS`. `Dockerfile` already runs `RUN npm run build:worker` and `RUN npm run build:worker-v2` and copies both `dist/worker.js` and `dist/worker-v2.js` into the runtime image.
- This means the "Deployment Design" and "Implementation Steps 1–9" originally scoped for this phase (branch, Docker wiring, image build, first `docker compose up -d worker-v2`) are **already done and merged directly to `main`**, not via a `deploy/worker-v2` branch + PR. This plan does not redo that work; Task 2 below is a read-only re-confirmation, not new wiring.
- Remaining real work for this phase: the dual-writer safety review the original deployment skipped, one resulting code change (a live-sync disable toggle), and the validation/evidence steps (10–14 in the original scope) which have not yet been executed and recorded.

---

## Dual-Writer Safety Review

Inspected write paths (`src/worker/bridge-consumer.ts`, `src/worker/equity-sampler.ts`, `src/worker-v2/deal-consumer.ts`, `src/worker-v2/order-consumer.ts`, `src/worker-v2/live-sync.ts`):

| Table | Legacy writer | Worker V2 writer | Idempotency key | Simultaneous writes safe? |
|---|---|---|---|---|
| `Deal` | `bridge-consumer.ts:87` `client.deal.upsert` | `deal-consumer.ts:42` `prisma.deal.upsert` | `@@unique([tradingAccountId, dealNo])` | **Yes** — both upsert on the identical natural key; no duplicate rows possible. Field values may momentarily reflect whichever writer ran last, but both compute the same MT5 record, so this is not a correctness risk. |
| `Order` | `bridge-consumer.ts:101` `client.order.upsert` | `order-consumer.ts:42` `prisma.order.upsert` | `@@unique([tradingAccountId, orderTicket])` | **Yes** — same reasoning as `Deal`. |
| `AccountSnapshot` | `equity-sampler.ts:143` `prisma.accountSnapshot.upsert`, polled every `WORKER_POLL_MS` (~150s legacy default, actually driven by the sampler's own interval) | `live-sync.ts:45` `prisma.accountSnapshot.upsert`, polled every `WORKER_V2_LIVE_SYNC_INTERVAL_MS` (2s default) | `tradingAccountId @unique` | **Not proven safe.** No duplicate rows (unique constraint), but the two writers race independently with no ordering contract — the dashboard's live snapshot can visibly flicker between a 2s-fresh Worker V2 value and a stale legacy value on every legacy poll tick. |
| `OpenPosition` | `equity-sampler.ts:149-152` — `$transaction([deleteMany({tradingAccountId}), createMany(...)])` | `live-sync.ts:71-73` — same `deleteMany` + `createMany` pattern, own transaction | `@@unique([tradingAccountId, positionNo])` | **Not proven safe.** Each transaction is atomic on its own, but nothing coordinates the two processes' delete+recreate cycles against each other — a legacy cycle and a Worker V2 cycle for the same account can interleave, producing a brief window where the table is empty (both mid-delete) or reflects whichever writer committed last, independent of true freshness. |
| `Position` (closed) | `bridge-consumer.ts:110` `client.position.upsert` | not written by Worker V2 | n/a | No overlap. |
| `ClosedPosition` | `bridge-consumer.ts:117` `client.closedPosition.upsert` | not written by Worker V2 | n/a | No overlap. |
| `EquitySnapshot` / `PositionExcursion` | `equity-sampler.ts:121,128` | not written by Worker V2 | n/a | No overlap. |
| `BridgeHistoryCheckpoint`/`Chunk`/`Record` (durable backfill state) | legacy only (`history-checkpoint.ts`) | not written by Worker V2 | n/a | No overlap — also the known accepted gap: Worker V2 has no checkpoint-based backfill/recovery and no ClosedPosition reconstruction. Tracked as Phase 5 follow-up, not blocking this phase. |

**Conclusion:** `Deal` and `Order` stream consumption are safe to run concurrently with the legacy worker as-is (unique-key idempotency proves it). `AccountSnapshot` and `OpenPosition` — Worker V2's `live-sync.ts` — are the two "overlapping live-state writes" the deployment scope calls out as needing to be disabled if not provably safe. They are not provably safe, so Task 1 adds a runtime toggle, defaulted **off**, to keep `live-sync.ts` from running during this validation phase while `deal-consumer.ts`/`order-consumer.ts`/health/recovery are exercised.

---

## Task 1: Add a runtime toggle to disable Worker V2's live-sync loop

**Files:**
- Modify: `src/worker-v2/index.ts:17` (add flag), `src/worker-v2/index.ts:91-108` (gate the loop)
- Modify: `docker-compose.yml` (`worker-v2` service `environment:` block)
- Test: `src/worker-v2/index.test.ts` (new — index.ts currently has no test file; this task adds the first one, scoped only to the new gating logic via an extracted pure function)

**Interfaces:**
- Consumes: existing `runLiveSyncLoop` from `./live-sync` (unchanged signature).
- Produces: `export function isLiveSyncEnabled(env: NodeJS.ProcessEnv): boolean` — pure function, `true` only when `env.WORKER_V2_ENABLE_LIVE_SYNC === "true"`, `false` for any other value including missing (safe default: disabled).

- [ ] **Step 1: Write the failing test**

```ts
// src/worker-v2/index.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLiveSyncEnabled } from "./index.ts";

test("isLiveSyncEnabled defaults to false when unset", () => {
  assert.equal(isLiveSyncEnabled({}), false);
});

test("isLiveSyncEnabled is false for any value other than the literal string 'true'", () => {
  assert.equal(isLiveSyncEnabled({ WORKER_V2_ENABLE_LIVE_SYNC: "1" }), false);
  assert.equal(isLiveSyncEnabled({ WORKER_V2_ENABLE_LIVE_SYNC: "TRUE" }), false);
  assert.equal(isLiveSyncEnabled({ WORKER_V2_ENABLE_LIVE_SYNC: "" }), false);
});

test("isLiveSyncEnabled is true only for the literal string 'true'", () => {
  assert.equal(isLiveSyncEnabled({ WORKER_V2_ENABLE_LIVE_SYNC: "true" }), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test src/worker-v2/index.test.ts`
Expected: FAIL — `isLiveSyncEnabled` is not exported from `./index.ts`.

- [ ] **Step 3: Implement the toggle**

In `src/worker-v2/index.ts`, add the pure export near the other env-derived constants (after line 19):

```ts
export function isLiveSyncEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.WORKER_V2_ENABLE_LIVE_SYNC === "true";
}

const LIVE_SYNC_ENABLED = isLiveSyncEnabled(process.env);
```

Replace the `Promise.all` block (current lines 91-108) so the live-sync loop only runs when enabled, and logs its disabled state so the health/deploy evidence can quote it directly:

```ts
  const loops: Promise<void>[] = [
    runConsumerLoop(dealsRedis, STREAM_DEALS, consumerName, dealHandler, {
      batchSize: BATCH_SIZE,
      blockMs: BLOCK_MS,
      idleReclaimMs: IDLE_RECLAIM_MS,
      signal: controller.signal,
    }),
    runConsumerLoop(ordersRedis, STREAM_ORDERS, consumerName, orderHandler, {
      batchSize: BATCH_SIZE,
      blockMs: BLOCK_MS,
      idleReclaimMs: IDLE_RECLAIM_MS,
      signal: controller.signal,
    }),
  ];
  if (LIVE_SYNC_ENABLED) {
    loops.push(
      runLiveSyncLoop(prisma, liveSyncRedis, registry, status, {
        intervalMs: LIVE_SYNC_INTERVAL_MS,
        signal: controller.signal,
      }),
    );
  } else {
    console.info("[worker-v2] live-sync disabled (WORKER_V2_ENABLE_LIVE_SYNC != 'true'); AccountSnapshot/OpenPosition writes are not active");
  }

  await Promise.all(loops);
```

Note: `liveSyncRedis` is still created and connected unconditionally (simplest correct diff — an unused-but-connected duplicate connection costs nothing at this scale and keeps the shutdown-quit logic below untouched); do not add conditional connection setup for this.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test src/worker-v2/index.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the env var to `docker-compose.yml`, defaulted off**

In the `worker-v2` service `environment:` block, add:

```yaml
      WORKER_V2_ENABLE_LIVE_SYNC: ${WORKER_V2_ENABLE_LIVE_SYNC:-false}
```

- [ ] **Step 6: Commit**

```bash
git add src/worker-v2/index.ts src/worker-v2/index.test.ts docker-compose.yml
git commit -m "feat(worker-v2): add WORKER_V2_ENABLE_LIVE_SYNC toggle, default off"
```

---

## Task 2: Re-confirm existing Docker wiring (read-only)

**Files:** read only — `Dockerfile`, `docker-compose.yml`, `package.json`

- [ ] **Step 1: Confirm the image builds both bundles**

Run: `grep -n "build:worker" Dockerfile`
Expected: both `RUN npm run build:worker` and `RUN npm run build:worker-v2` present.

- [ ] **Step 2: Confirm the runtime image copies both bundles**

Run: `grep -n "dist" Dockerfile`
Expected: the runner stage copies `dist/worker.js` and `dist/worker-v2.js` (or the whole `dist/` directory).

- [ ] **Step 3: Confirm the compose service definition matches the reviewed table above**

Run: `grep -n -A 20 "^  worker-v2:" docker-compose.yml`
Expected: service present with `command: node dist/worker-v2.js`, health check on the configured `WORKER_V2_HEALTH_PORT`, and (after Task 1) `WORKER_V2_ENABLE_LIVE_SYNC` present and defaulted to `false`.

No commit for this task — verification only.

---

## Task 3: Validate configuration before deploying the toggle

- [ ] **Step 1: Run the full Worker V2 unit suite**

Run:
```bash
node --import tsx --test \
  src/worker-v2/decimal.test.ts \
  src/worker-v2/account-registry.test.ts \
  src/worker-v2/validators.test.ts \
  src/worker-v2/mappers.test.ts \
  src/worker-v2/health.test.ts \
  src/worker-v2/stream-consumer.test.ts \
  src/worker-v2/deal-consumer.test.ts \
  src/worker-v2/order-consumer.test.ts \
  src/worker-v2/live-sync.test.ts \
  src/worker-v2/index.test.ts
```
Expected: all PASS (47 tests: the prior 44 plus the 3 new toggle tests).

- [ ] **Step 2: Type-check, lint, build**

Run in order:
```bash
npx tsc --noEmit
npm run lint
npm run build
npm run build:worker-v2
```
Expected: no new errors attributable to this change. Report any pre-existing failures separately from anything newly introduced.

- [ ] **Step 3: Confirm the bundle exists**

Run: `test -f dist/worker-v2.js && echo present`
Expected: `present`.

- [ ] **Step 4: Validate the compose file parses**

Run: `docker compose config >/dev/null && echo valid`
Expected: `valid`.

No commit for this task (verification only).

---

## Task 4: Deploy the toggle and confirm container health

- [ ] **Step 1: Rebuild and restart only `worker-v2`**

Run:
```bash
docker compose build worker-v2
docker compose up -d worker-v2
```
Do not touch `db`, `redis`, or `worker`.

- [ ] **Step 2: Confirm the runtime image contains the new bundle**

Run:
```bash
docker compose run --rm --no-deps worker-v2 \
  sh -lc 'test -f dist/worker-v2.js && ls -lh dist/worker-v2.js'
```

- [ ] **Step 3: Confirm all six services are up and `worker-v2` is healthy without restart loops**

Run:
```bash
docker compose ps
docker compose logs --tail=200 worker-v2
```
Expected services: `db`, `redis`, `web`, `worker`, `worker-v2`, `caddy`. Logs must include the Task 1 line `[worker-v2] live-sync disabled ...` and must **not** show a crash/restart loop.

- [ ] **Step 4: Verify the health endpoint**

Run:
```bash
docker compose exec -T worker-v2 curl -fsS http://localhost:9200/health
```
Expected: `200` with a `WorkerV2Snapshot` JSON body (`startedAt`, `streams.deals`, `streams.orders`, `accounts`, `dbLatencyMsLast`) confirming the process is up and reachable; the empty `accounts: {}` and zero counters before any stream traffic is expected and fine at this point.

Record the raw response verbatim for the completion report.

---

## Task 5: Verify Redis stream consumption

- [ ] **Step 1: Check stream length and consumer group state**

Run:
```bash
docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" XLEN mt5:v2:history:deals
docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" XLEN mt5:v2:history:orders
docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" XINFO GROUPS mt5:v2:history:deals
docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" XINFO GROUPS mt5:v2:history:orders
```
Expected: a group named `worker-v2` (from `WORKER_V2_GROUP` in `src/worker-v2/stream-consumer.ts`) exists on both streams, with a `last-delivered-id` that is non-zero once Bridge V2 has published at least one entry.

- [ ] **Step 2: Check pending entries**

Run:
```bash
docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" XPENDING mt5:v2:history:deals worker-v2
docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" XPENDING mt5:v2:history:orders worker-v2
```
Expected: pending count is `0` or actively shrinking across repeated checks a few seconds apart (i.e., the consumer is acking, not stuck).

- [ ] **Step 3: Confirm delivered-ID advances over a short window**

Run `XINFO GROUPS` again after 30-60 seconds and compare `last-delivered-id` to Step 1's value; it must have advanced whenever Bridge V2 published new entries in that window (cross-check against `XLEN` growth).

Record all four command outputs verbatim (before/after) for the completion report.

---

## Task 6: Verify PostgreSQL Deal/Order persistence and replay idempotency

- [ ] **Step 1: Record row counts before/after a wait window**

Run against the deployed DB (via `docker compose exec -T db psql` or the app's `DATABASE_URL`):
```sql
SELECT count(*) FROM "Deal";
SELECT count(*) FROM "Order";
```
Wait 2-5 minutes, run again. Expected: counts increase (assuming Bridge V2 is actively publishing).

- [ ] **Step 2: Confirm at least two distinct accounts are represented**

```sql
SELECT ta.account_no, count(*) FROM "Deal" d
  JOIN "TradingAccount" ta ON ta.id = d.trading_account_id
  GROUP BY ta.account_no
  ORDER BY count(*) DESC
  LIMIT 5;
```
Expected: rows for ≥2 distinct `account_no` values with recent activity.

- [ ] **Step 3: Inspect recent records for field correctness**

```sql
SELECT deal_no, time, symbol, volume, price, profit, commission, swap, order_id, position_id
  FROM "Deal" ORDER BY time DESC LIMIT 5;
SELECT order_ticket, symbol, type, state, price_open, sl, tp, time_setup, time_done
  FROM "Order" ORDER BY time_setup DESC NULLS LAST LIMIT 5;
```
Expected: plausible, non-null values matching what Bridge V2 published (cross-check one row's `deal_no`/`order_ticket` against the corresponding Redis stream entry from Task 5 if still available via `XRANGE`).

- [ ] **Step 4: Prove duplicate replay does not duplicate rows**

Pick one already-persisted `deal_no`/`order_ticket`. Re-publish an equivalent entry manually:
```bash
docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" XADD mt5:v2:history:deals '*' \
  data '{"login":<real-login>,"kind":"deal","record":{"ticket":<existing-ticket>,"time":<same-time>,"profit":<changed-value>}}'
```
Wait one poll cycle, then re-run `SELECT count(*) FROM "Deal" WHERE deal_no = '<existing-ticket>'`. Expected: still `1` row, with `profit` updated to the new value (upsert, not insert).

Record all counts and sample rows verbatim.

---

## Task 7: Verify crash recovery (pending-entry reclaim)

- [ ] **Step 1: Stop `worker-v2` and publish one new entry while it's down**

```bash
docker compose stop worker-v2
docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" XADD mt5:v2:history:deals '*' \
  data '{"login":<real-login>,"kind":"deal","record":{"ticket":<new-test-ticket>,"time":<epoch-now>,"profit":1}}'
```

- [ ] **Step 2: Confirm it is not yet delivered to the group (no consumer running)**

```bash
docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" XLEN mt5:v2:history:deals
```
Expected: length includes the new entry, but `XPENDING` for it is empty (never delivered — the consumer wasn't running to claim it, so it's simply un-delivered, which is the same durability guarantee).

- [ ] **Step 3: Restart `worker-v2` and confirm the entry is consumed**

```bash
docker compose start worker-v2
```
Wait past `WORKER_V2_BLOCK_MS`/one poll cycle, then:
```bash
docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" XPENDING mt5:v2:history:deals worker-v2
```
Expected: `0` pending; the new entry was picked up on the next `XREADGROUP` (id `>`).

- [ ] **Step 4: Confirm exactly one row persisted**

```sql
SELECT count(*) FROM "Deal" WHERE deal_no = '<new-test-ticket>';
```
Expected: `1`.

Do not lower `WORKER_V2_IDLE_RECLAIM_MS` in the production compose file for this test — if a faster reclaim test is wanted, run it against the isolated `test:env` stack (`npm run test:env:up`) with a temporarily lowered value there instead, per `docs/superpowers/plans/2026-07-14-worker-v2-redis-to-postgres.md` Task 12 Step 6.

Record command output and the row count for the completion report.

---

## Task 8: Verify per-account isolation

- [ ] **Step 1: Publish one malformed entry for a real/test login and one valid entry for a different account, in the same window**

```bash
docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" XADD mt5:v2:history:deals '*' \
  data '{"login":<account-A-login>,"kind":"deal","record":{"ticket":"bad","time":"not-a-number"}}'
docker compose exec -T redis redis-cli -a "$REDIS_PASSWORD" XADD mt5:v2:history:deals '*' \
  data '{"login":<account-B-login>,"kind":"deal","record":{"ticket":<valid-ticket>,"time":<epoch-now>,"profit":1}}'
```

- [ ] **Step 2: Confirm account B persists while account A's entry is logged and acked (isolated, not poison-looping)**

```bash
docker compose logs --tail=50 worker-v2
```
Expected: one log line noting the account-A validation failure (ticket/login/reason), and:
```sql
SELECT count(*) FROM "Deal" WHERE deal_no = '<valid-ticket>';
```
returns `1`. Also confirm the consumer loop kept running afterward (`XPENDING` for both entries is `0` — the malformed one was acked-and-logged per the Global Constraints in the Worker V2 implementation plan, not left stuck).

Record the log line and query result verbatim.

---

## Task 9: Verify legacy worker stability is unaffected

- [ ] **Step 1: Check legacy worker health and logs**

```bash
docker compose ps worker
docker compose logs --tail=100 worker
docker compose exec -T worker curl -fsS http://localhost:9100/health
```
Expected: `worker` still healthy, no new errors, no unexpected restart since before Task 4.

- [ ] **Step 2: Confirm the dashboard still serves fresh data**

```bash
curl -fsS https://therng.duckdns.org/api/health
curl -fsS https://therng.duckdns.org/api/accounts | head -c 500
```
Expected: `/api/health` returns `ok`; `/api/accounts` returns current account data with `last_updated` within the last couple of minutes for actively-trading accounts (matching the standard already verified for the prior bridge cutover in `TODO.md`).

No commit for this task (verification only).

---

## Task 10: Completion report

Compile the report using the evidence recorded in Tasks 1–9, matching this exact list (do not omit an item — if something has no evidence, say so explicitly rather than skipping it):

1. Branch name and commit SHA for Task 1's toggle change.
2. Exact changed-file list (`git diff --stat` against the commit before Task 1).
3. `Dockerfile`/`docker-compose.yml` diff summary (Task 1 Step 5 only — the rest was already merged).
4. Worker V2 compose service definition (current, post-Task-1).
5. Worker V2 runtime command and env vars, including the new `WORKER_V2_ENABLE_LIVE_SYNC` default.
6. Health endpoint URL and raw response (Task 4 Step 4).
7. Dual-writer assessment table (from this plan's "Dual-Writer Safety Review" section — reproduce or link it).
8. Unit test results (Task 3 Step 1).
9. TypeScript, lint, and Next.js build results (Task 3 Step 2).
10. Worker V2 bundle build result (Task 3 Step 3) and Docker image build result (Task 4 Step 1).
11. Container status for all six services (Task 4 Step 3).
12. Redis stream lengths and consumer-group state, before/after (Task 5).
13. Pending-entry state (Task 5 Step 2, Task 7).
14. PostgreSQL `Deal`/`Order` counts before/after (Task 6 Step 1).
15. Evidence from at least two accounts (Task 6 Step 2).
16. Idempotency evidence — duplicate replay result (Task 6 Step 4).
17. Recovery evidence — pending-entry reclaim (Task 7).
18. Account-isolation evidence (Task 8).
19. Legacy worker health and dashboard freshness (Task 9).
20. Confirmation that live-sync (`AccountSnapshot`/`OpenPosition`) remained disabled throughout this validation window, per the dual-writer review.
21. Remaining risks: (a) `AccountSnapshot`/`OpenPosition` dual-write is still unresolved — Worker V2's live-sync path stays off until a Phase 5 either coordinates the two writers or fully cuts the legacy equity-sampler over; (b) Worker V2 has no durable checkpoint-based backfill/recovery and no `ClosedPosition` reconstruction — accepted gap, tracked as Phase 5 follow-up per user decision on 2026-07-14; (c) any failures or deviations surfaced during Tasks 3-9.
22. Recommended Phase 5 scope: resolve the `AccountSnapshot`/`OpenPosition` dual-write (either coordinate or cut legacy's equity-sampler for those two tables), then close the backfill/`ClosedPosition` gap, before any consideration of retiring the legacy worker entirely.

No commit for this task — delivered as a message to the user (and, if the user asks, appended to `TODO.md` under a new "Worker V2 Phase 4" entry mirroring the existing "Bridge cutover" section's format). Do not run `git push` beyond Task 1's branch, and do not merge Task 1's PR automatically.

---

## Self-Review Notes

- Scope coverage: every item in the user's "Acceptance Criteria" list maps to a task above (Docker image/bundle → Task 2/3/4; health → Task 4; streams/pending → Task 5/7; Postgres counts/multi-account/idempotency → Task 6; account isolation → Task 8; legacy stability → Task 9; no data/consumer-group destructive actions → enforced by Global Constraints and by every step above being read-only or additive).
- Deviation from the user's literal step list is called out explicitly in "Current State": deployment wiring (steps 1-9 of the original scope) is already merged to `main` directly, not on a `deploy/worker-v2` branch — this plan does not re-do it or retroactively branch it, only re-confirms it (Task 2) and adds the one missing safety control (Task 1) on its own small branch.
- Type/name consistency: `isLiveSyncEnabled`/`WORKER_V2_ENABLE_LIVE_SYNC`/`LIVE_SYNC_ENABLED` are the only new identifiers introduced, used consistently across Task 1's steps.
