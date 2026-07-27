import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_RECORDS_SHA256,
  ensureHistoryCheckpoint,
  persistHistoryRecord,
  persistHistoryBarrier,
  reconcileChunkPositions,
  nextRecordsSha256,
  mirrorHistoryCheckpoint,
  historyAckKey,
  type HistoryRecordEnvelope,
  type HistoryBarrierEnvelope,
  type ReconstructPositionFn,
  type RedisLike,
} from "./history-checkpoint";

function fakeRedis() {
  const kv = new Map<string, string>();
  const redis: RedisLike = {
    set: async (key, value) => {
      kv.set(key, value);
    },
    del: async (key) => {
      kv.delete(key);
    },
  };
  return { redis, kv };
}

function dealPayloadSha(dealNo: string): string {
  return `deal-${dealNo}`.padEnd(64, "0");
}

/** Chained digest matching what persistHistoryRecord actually accumulates across these dealNos, in order. */
function chainedDigest(dealNos: string[]): string {
  return dealNos.reduce((acc, dealNo) => nextRecordsSha256(acc, dealPayloadSha(dealNo)), EMPTY_RECORDS_SHA256);
}

// Package 3b contract (docs/superpowers/plans/2026-07-25-worker-v2-package-3b-
// durable-history-checkpoint-plan.md §1a): for stream "deals", eventKey MUST
// equal dealNo exactly. Deals are stored by the fake db's own deal.upsert, and
// touched-position derivation reads them back via deal.findMany, exactly as
// deriveTouchedPositions does in production.
function fakeDb() {
  const chunks = new Map<string, any>();
  const receipts = new Map<string, any>();
  const deals = new Map<string, any>(); // `${accountId}:${dealNo}` -> deal row
  const initialCheckpoint: any = {
    tradingAccountId: "acct-1",
    phase: "backfill",
    completedThroughServerTime: 946684800n,
    dealsCursorTime: 946684800n,
    dealsCursorTicket: 0n,
    ordersCursorTime: 946684800n,
    ordersCursorTicket: 0n,
    lastCompletedChunkId: null,
    backfillCompletedAt: null,
  };
  const checkpoints = new Map<string, any>([["acct-1", initialCheckpoint]]);
  const db: any = {
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
    deal: {
      upsert: async ({ where, create }: any) => {
        const key = `${where.tradingAccountId_dealNo.tradingAccountId}:${where.tradingAccountId_dealNo.dealNo}`;
        deals.set(key, create);
        return create;
      },
      findMany: async ({ where }: any) => {
        const inSet = new Set(where.dealNo.in as string[]);
        return [...deals.values()].filter(
          (d) => d.tradingAccountId === where.tradingAccountId && inSet.has(d.dealNo),
        );
      },
    },
    order: { upsert: async () => {} },
    bridgeHistoryChunk: {
      findUnique: async ({ where }: any) => chunks.get(where.id) ?? null,
      create: async ({ data }: any) => {
        const row = {
          ...data,
          dealsAppliedCount: 0,
          ordersAppliedCount: 0,
          dealsAppliedDigest: EMPTY_RECORDS_SHA256,
          ordersAppliedDigest: EMPTY_RECORDS_SHA256,
          positionsAppliedDigest: EMPTY_RECORDS_SHA256,
          dealsBarrierAt: null,
          ordersBarrierAt: null,
          positionsBarrierAt: null,
          reconstructionState: null,
          completedAt: null,
        };
        chunks.set(data.id, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = { ...chunks.get(where.id), ...data };
        chunks.set(where.id, row);
        return row;
      },
      upsert: async ({ where, create }: any) => {
        let row = chunks.get(where.id);
        if (!row) {
          row = {
            ...create,
            dealsAppliedCount: 0,
            ordersAppliedCount: 0,
            dealsAppliedDigest: EMPTY_RECORDS_SHA256,
            ordersAppliedDigest: EMPTY_RECORDS_SHA256,
            positionsAppliedDigest: EMPTY_RECORDS_SHA256,
            dealsBarrierAt: null,
            ordersBarrierAt: null,
            positionsBarrierAt: null,
            reconstructionState: null,
            completedAt: null,
          };
          chunks.set(where.id, row);
        }
        return row;
      },
    },
    bridgeHistoryCheckpoint: {
      findUnique: async ({ where }: any) => checkpoints.get(where.tradingAccountId) ?? null,
      create: async ({ data }: any) => {
        const row = { ...data, lastCompletedChunkId: null, backfillCompletedAt: null };
        checkpoints.set(data.tradingAccountId, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = { ...checkpoints.get(where.tradingAccountId), ...data };
        checkpoints.set(where.tradingAccountId, row);
        return row;
      },
    },
    bridgeHistoryRecord: {
      findUnique: async ({ where }: any) => {
        const key = where.chunkId_stream_ordinal;
        return receipts.get(`${key.chunkId}:${key.stream}:${key.ordinal}`) ?? null;
      },
      findMany: async ({ where }: any) => {
        return [...receipts.values()].filter((r) => r.chunkId === where.chunkId && r.stream === where.stream);
      },
      create: async ({ data }: any) => {
        receipts.set(`${data.chunkId}:${data.stream}:${data.ordinal}`, data);
        return data;
      },
    },
  };
  return { db, chunks, checkpoints, receipts, deals };
}

function envelope(overrides: Partial<HistoryRecordEnvelope> = {}): HistoryRecordEnvelope {
  return {
    chunkId: "chunk-1",
    parentChunkId: null,
    windowStartServerTime: "946684800",
    windowEndServerTime: "949276800",
    reachedPresent: false,
    dealCursor: { time: "946684800", ticket: "1" },
    orderCursor: { time: "946684800", ticket: "0" },
    ordinal: 0,
    expectedCount: 1,
    eventKey: "1",
    payloadSha256: "a".repeat(64),
    ...overrides,
  };
}

function barrierEnvelope(overrides: Partial<HistoryBarrierEnvelope> = {}): HistoryBarrierEnvelope {
  return {
    stream: "deals",
    chunkId: "chunk-1",
    parentChunkId: null,
    windowStartServerTime: "946684800",
    windowEndServerTime: "949276800",
    reachedPresent: false,
    dealCursor: { time: "946684800", ticket: "1" },
    orderCursor: { time: "946684800", ticket: "0" },
    recordCount: 1,
    recordsSha256: EMPTY_RECORDS_SHA256,
    ...overrides,
  };
}

/** Records one deal into the fake db exactly as deal-consumer.ts would, via persistHistoryRecord. */
async function recordDeal(
  db: any,
  accountId: string,
  dealNo: string,
  positionId: string | null,
  direction: string,
  ordinal: number,
  expectedCount: number,
  reachedPresent = false,
  envelopeOverrides: Partial<HistoryRecordEnvelope> = {},
) {
  await persistHistoryRecord(
    db,
    accountId,
    "deals",
    envelope({
      eventKey: dealNo,
      ordinal,
      expectedCount,
      reachedPresent,
      payloadSha256: dealPayloadSha(dealNo),
      ...envelopeOverrides,
    }),
    async (tx) => {
      await tx.deal.upsert({
        where: { tradingAccountId_dealNo: { tradingAccountId: accountId, dealNo } },
        create: { tradingAccountId: accountId, dealNo, positionId, direction },
        update: { tradingAccountId: accountId, dealNo, positionId, direction },
      });
    },
  );
}

const alwaysOpen: ReconstructPositionFn = async () => ({ status: "open" });
const alwaysClosed: ReconstructPositionFn = async () => ({ status: "closed" });

test("ensureHistoryCheckpoint creates initial checkpoint at 2025-01-01 backfill phase", async () => {
  const { db } = fakeDb();
  db.bridgeHistoryCheckpoint.findUnique = async () => null;
  const checkpoint = await ensureHistoryCheckpoint(db, "acct-2");
  assert.equal(checkpoint.phase, "backfill");
  assert.equal(checkpoint.completedThroughServerTime, "1735689600");
  assert.equal(checkpoint.backfillCompletedAt, null);
});

test("ensureHistoryCheckpoint returns existing checkpoint unchanged", async () => {
  const { db } = fakeDb();
  const checkpoint = await ensureHistoryCheckpoint(db, "acct-1");
  assert.equal(checkpoint.phase, "backfill");
  assert.equal(checkpoint.accountId, "acct-1");
});

test("ensureHistoryCheckpoint clears a stale ack mirror when creating a fresh checkpoint", async () => {
  const { db } = fakeDb();
  db.bridgeHistoryCheckpoint.findUnique = async () => null;
  const { redis, kv } = fakeRedis();
  kv.set(historyAckKey("1002"), JSON.stringify({ stale: true }));

  await ensureHistoryCheckpoint(db, "acct-2", redis, "1002");
  assert.equal(kv.has(historyAckKey("1002")), false, "stale ack must be deleted on fresh-checkpoint creation");
});

test("ensureHistoryCheckpoint does not touch the ack mirror when the checkpoint already exists", async () => {
  const { db } = fakeDb();
  const { redis, kv } = fakeRedis();
  kv.set(historyAckKey("1001"), JSON.stringify({ ready: true }));

  await ensureHistoryCheckpoint(db, "acct-1", redis, "1001");
  assert.equal(kv.has(historyAckKey("1001")), true, "an existing checkpoint's ack must not be cleared");
});

test("ensureHistoryCheckpoint creation succeeds even if redis is omitted", async () => {
  const { db } = fakeDb();
  db.bridgeHistoryCheckpoint.findUnique = async () => null;
  const checkpoint = await ensureHistoryCheckpoint(db, "acct-3");
  assert.equal(checkpoint.phase, "backfill");
});

test("mirrorHistoryCheckpoint writes the ack key with the checkpoint payload", async () => {
  const { redis, kv } = fakeRedis();
  const checkpoint = {
    accountId: "acct-1",
    phase: "incremental" as const,
    completedThroughServerTime: "949276800",
    dealsCursor: { time: "949276800", ticket: "0" },
    ordersCursor: { time: "949276800", ticket: "0" },
    lastCompletedChunkId: "chunk-1",
    backfillCompletedAt: "2026-07-26T00:00:00.000Z",
  };
  await mirrorHistoryCheckpoint(redis, "1001", checkpoint);
  const written = JSON.parse(kv.get(historyAckKey("1001"))!);
  assert.equal(written.version, 1);
  assert.equal(written.ready, true);
  assert.equal(written.phase, "incremental");
  assert.equal(written.completedThroughServerTime, "949276800");
  assert.equal(written.lastCompletedChunkId, "chunk-1");
});

test("mirrorHistoryCheckpoint failure is swallowed (logged, not thrown)", async () => {
  const redis: RedisLike = {
    set: async () => {
      throw new Error("redis down");
    },
    del: async () => {},
  };
  const checkpoint = {
    accountId: "acct-1",
    phase: "backfill" as const,
    completedThroughServerTime: "946684800",
    dealsCursor: { time: "946684800", ticket: "0" },
    ordersCursor: { time: "946684800", ticket: "0" },
    lastCompletedChunkId: null,
    backfillCompletedAt: null,
  };
  await mirrorHistoryCheckpoint(redis, "1001", checkpoint); // must not throw
});

test("persistHistoryRecord writes domain row once and creates chunk on first record", async () => {
  const { db, chunks } = fakeDb();
  let writes = 0;
  await persistHistoryRecord(db, "acct-1", "deals", envelope(), async () => {
    writes += 1;
  });
  assert.equal(writes, 1);
  const chunk = chunks.get("acct-1:chunk-1");
  assert.equal(chunk.dealsAppliedCount, 1);
  assert.equal(chunk.dealsExpectedCount, 1);
});

test("persistHistoryRecord is idempotent on exact replay", async () => {
  const { db } = fakeDb();
  let writes = 0;
  const env = envelope();
  await persistHistoryRecord(db, "acct-1", "deals", env, async () => {
    writes += 1;
  });
  await persistHistoryRecord(db, "acct-1", "deals", env, async () => {
    writes += 1;
  });
  assert.equal(writes, 1);
});

test("persistHistoryRecord throws on digest conflict at same ordinal", async () => {
  const { db } = fakeDb();
  const env = envelope();
  await persistHistoryRecord(db, "acct-1", "deals", env, async () => {});
  await assert.rejects(
    () =>
      persistHistoryRecord(
        db,
        "acct-1",
        "deals",
        { ...env, eventKey: "2", payloadSha256: "b".repeat(64) },
        async () => {},
      ),
    /digest conflict/,
  );
});

test("persistHistoryRecord throws on ordinal gap", async () => {
  const { db } = fakeDb();
  const env = envelope();
  await persistHistoryRecord(db, "acct-1", "deals", env, async () => {});
  await assert.rejects(
    () => persistHistoryRecord(db, "acct-1", "deals", { ...env, ordinal: 2 }, async () => {}),
    /ordinal gap/,
  );
});

test("persistHistoryRecord throws on chunk metadata fork", async () => {
  const { db } = fakeDb();
  const env = envelope();
  await persistHistoryRecord(db, "acct-1", "deals", env, async () => {});
  await assert.rejects(
    () =>
      persistHistoryRecord(
        db,
        "acct-1",
        "deals",
        { ...env, windowEndServerTime: "999999999" },
        async () => {},
      ),
    /metadata fork/,
  );
});

test("same transport chunk ID keeps independent accounts isolated", async () => {
  const { db, chunks } = fakeDb();
  await persistHistoryRecord(db, "acct-1", "deals", envelope(), async () => {});
  await persistHistoryRecord(db, "acct-2", "deals", envelope({ eventKey: "2" }), async () => {});
  assert.ok(chunks.has("acct-1:chunk-1"));
  assert.ok(chunks.has("acct-2:chunk-1"));
  assert.equal(chunks.get("acct-1:chunk-1").dealsAppliedCount, 1);
  assert.equal(chunks.get("acct-2:chunk-1").dealsAppliedCount, 1);
});

// --- Positions barrier / reconciliation -----------------------------------

test("reconcileChunkPositions: one Position with multiple Deals is reconstructed exactly once", async () => {
  const { db } = fakeDb();
  await recordDeal(db, "acct-1", "1", "pos-1", "in", 0, 3);
  await recordDeal(db, "acct-1", "2", "pos-1", "out", 1, 3);
  await recordDeal(db, "acct-1", "3", "pos-1", "out", 2, 3);
  let calls = 0;
  const countingReconstruct: ReconstructPositionFn = async () => {
    calls += 1;
    return { status: "closed" };
  };
  const state = await reconcileChunkPositions(db, "acct-1", "acct-1:chunk-1", countingReconstruct);
  assert.equal(calls, 1, "one position touched by 3 deals must be reconstructed exactly once");
  assert.equal(state.touchedPositionCount, 1);
  assert.equal(state.resolvedPositionCount, 1);
  assert.equal(state.blocking.length, 0);
});

test("reconcileChunkPositions: partial close then final close resolves as one position", async () => {
  const { db } = fakeDb();
  await recordDeal(db, "acct-1", "1", "pos-1", "in", 0, 3);
  await recordDeal(db, "acct-1", "2", "pos-1", "out", 1, 3); // partial close
  await recordDeal(db, "acct-1", "3", "pos-1", "out", 2, 3); // final close
  const state = await reconcileChunkPositions(db, "acct-1", "acct-1:chunk-1", alwaysClosed);
  assert.equal(state.touchedPositionCount, 1);
  assert.equal(state.resolvedPositionCount, 1);
});

test("reconcileChunkPositions: zero touched positions when chunk has no position-changing deals", async () => {
  const { db } = fakeDb();
  // A deal exists but with a non-position-changing direction (e.g. balance op) -> not touched.
  await recordDeal(db, "acct-1", "1", null, "balance", 0, 1);
  const state = await reconcileChunkPositions(db, "acct-1", "acct-1:chunk-1", alwaysClosed);
  assert.equal(state.touchedPositionCount, 0);
  assert.equal(state.resolvedPositionCount, 0);
  assert.equal(state.blocking.length, 0);
});

test("reconcileChunkPositions: still-open is a successful (non-blocking) outcome", async () => {
  const { db } = fakeDb();
  await recordDeal(db, "acct-1", "1", "pos-1", "in", 0, 1);
  const state = await reconcileChunkPositions(db, "acct-1", "acct-1:chunk-1", alwaysOpen);
  assert.equal(state.resolvedPositionCount, 1);
  assert.equal(state.blocking.length, 0);
});

test("reconcileChunkPositions: corrupted outcome blocks and is stored durably", async () => {
  const { db, chunks } = fakeDb();
  await recordDeal(db, "acct-1", "1", "pos-1", "in", 0, 1);
  const corrupted: ReconstructPositionFn = async () => ({ status: "corrupted", reason: "missing-price" });
  const state = await reconcileChunkPositions(db, "acct-1", "acct-1:chunk-1", corrupted);
  assert.equal(state.blocking.length, 1);
  assert.equal(state.blocking[0].positionId, "pos-1");
  assert.equal(state.blocking[0].outcome, "corrupted");
  assert.equal(state.blocking[0].reason, "missing-price");
  assert.deepEqual(state.blocking[0].dealIds, ["1"]);
  const chunk = chunks.get("acct-1:chunk-1");
  assert.equal(chunk.positionsBarrierAt, null, "blocking outcome must not stamp the positions barrier");
  assert.deepEqual(chunk.reconstructionState, state, "reconstructionState must be durably persisted on the chunk");
});

test("reconcileChunkPositions: ambiguous-reopen outcome blocks", async () => {
  const { db, chunks } = fakeDb();
  await recordDeal(db, "acct-1", "1", "pos-1", "in", 0, 1);
  const ambiguous: ReconstructPositionFn = async () => ({ status: "ambiguous-reopen" });
  const state = await reconcileChunkPositions(db, "acct-1", "acct-1:chunk-1", ambiguous);
  assert.equal(state.blocking.length, 1);
  assert.equal(state.blocking[0].outcome, "ambiguous-reopen");
  assert.equal(chunks.get("acct-1:chunk-1").positionsBarrierAt, null);
});

test("reconcileChunkPositions: automatic retry resolves once underlying data becomes valid", async () => {
  const { db, chunks } = fakeDb();
  await recordDeal(db, "acct-1", "1", "pos-1", "in", 0, 1);
  let shouldFail = true;
  const eventuallyValid: ReconstructPositionFn = async () =>
    shouldFail ? { status: "corrupted", reason: "missing-price" } : { status: "closed" };

  const first = await reconcileChunkPositions(db, "acct-1", "acct-1:chunk-1", eventuallyValid);
  assert.equal(first.blocking.length, 1);
  assert.equal(chunks.get("acct-1:chunk-1").positionsBarrierAt, null);

  shouldFail = false; // underlying data corrected
  const retry = await reconcileChunkPositions(db, "acct-1", "acct-1:chunk-1", eventuallyValid);
  assert.equal(retry.blocking.length, 0, "retry must re-attempt and resolve the previously-blocking position");
  assert.equal(retry.resolvedPositionCount, 1);
  assert.ok(chunks.get("acct-1:chunk-1").positionsBarrierAt, "positions barrier must stamp once resolved");
});

test("reconcileChunkPositions: already-resolved positions are not re-attempted on retry", async () => {
  const { db } = fakeDb();
  await recordDeal(db, "acct-1", "1", "pos-1", "in", 0, 2);
  await recordDeal(db, "acct-1", "2", "pos-2", "in", 1, 2);
  const calls: Record<string, number> = {};
  const trackCalls: ReconstructPositionFn = async (_tx, positionId) => {
    calls[positionId] = (calls[positionId] ?? 0) + 1;
    if (positionId === "pos-2") return { status: "corrupted", reason: "missing-symbol" };
    return { status: "closed" };
  };
  await reconcileChunkPositions(db, "acct-1", "acct-1:chunk-1", trackCalls);
  assert.equal(calls["pos-1"], 1);
  assert.equal(calls["pos-2"], 1);

  await reconcileChunkPositions(db, "acct-1", "acct-1:chunk-1", trackCalls);
  assert.equal(calls["pos-1"], 1, "pos-1 already resolved 'closed' must not be re-attempted");
  assert.equal(calls["pos-2"], 2, "pos-2 still blocking must be re-attempted");
});

// --- persistHistoryBarrier --------------------------------------------------

test("persistHistoryBarrier: brand-new account with no pre-existing checkpoint row does not throw", async () => {
  const { db, checkpoints } = fakeDb();
  assert.equal(checkpoints.has("acct-new"), false, "sanity: no checkpoint pre-seeded for this account");

  const retainedWindow = {
    chunkId: "retained-chunk-1",
    windowStartServerTime: "1735689600",
    windowEndServerTime: "1738281600",
    dealCursor: { time: "1738281600", ticket: "0" },
    orderCursor: { time: "1738281600", ticket: "0" },
  };
  await recordDeal(db, "acct-new", "1", "pos-1", "in", 0, 1, true, retainedWindow);
  const dealsResult = await persistHistoryBarrier(
    db,
    "acct-new",
    barrierEnvelope({
      ...retainedWindow,
      stream: "deals",
      recordCount: 1,
      recordsSha256: chainedDigest(["1"]),
      reachedPresent: true,
    }),
    alwaysClosed,
  );
  assert.equal(dealsResult, null, "orders barrier hasn't landed yet");

  const ordersResult = await persistHistoryBarrier(
    db,
    "acct-new",
    barrierEnvelope({ ...retainedWindow, stream: "orders", recordCount: 0, reachedPresent: true }),
    alwaysClosed,
  );
  assert.ok(ordersResult, "checkpoint must be created on demand and then advance, not throw");
  assert.equal(ordersResult!.phase, "incremental");
  assert.equal(checkpoints.get("acct-new").lastCompletedChunkId, "retained-chunk-1");
});

test("persistHistoryBarrier: forwards redis/accountNo so a fresh checkpoint clears a stale ack", async () => {
  const { db } = fakeDb();
  const { redis, kv } = fakeRedis();
  kv.set(historyAckKey("2002"), JSON.stringify({ stale: true }));

  // ensureHistoryCheckpoint only runs once all three barriers (deals, orders,
  // positions) complete — need both wire barriers to reach that code path.
  await recordDeal(db, "acct-fresh", "1", "pos-1", "in", 0, 1, true);
  await persistHistoryBarrier(
    db,
    "acct-fresh",
    barrierEnvelope({ stream: "deals", recordCount: 1, recordsSha256: chainedDigest(["1"]), reachedPresent: true }),
    alwaysClosed,
    redis,
    "2002",
  );
  await persistHistoryBarrier(
    db,
    "acct-fresh",
    barrierEnvelope({ stream: "orders", recordCount: 0, reachedPresent: true }),
    alwaysClosed,
    redis,
    "2002",
  );
  assert.equal(kv.has(historyAckKey("2002")), false, "stale ack cleared when persistHistoryBarrier creates a fresh checkpoint");
});

test("persistHistoryBarrier: works unchanged when redis/accountNo are omitted", async () => {
  const { db } = fakeDb();
  await recordDeal(db, "acct-1", "1", "pos-1", "in", 0, 1, true);
  const result = await persistHistoryBarrier(
    db,
    "acct-1",
    barrierEnvelope({ stream: "deals", recordCount: 1, recordsSha256: chainedDigest(["1"]), reachedPresent: true }),
    alwaysClosed,
  );
  assert.equal(result, null, "orders barrier hasn't landed yet — still correct with no redis argument");
});

test("persistHistoryBarrier: full happy path advances checkpoint to incremental", async () => {
  const { db, checkpoints } = fakeDb();
  await recordDeal(db, "acct-1", "1", "pos-1", "in", 0, 2, true);
  await recordDeal(db, "acct-1", "2", "pos-1", "out", 1, 2, true);

  const dealsResult = await persistHistoryBarrier(
    db,
    "acct-1",
    barrierEnvelope({
      stream: "deals",
      recordCount: 2,
      recordsSha256: chainedDigest(["1", "2"]),
      reachedPresent: true,
    }),
    alwaysClosed,
  );
  assert.equal(dealsResult, null, "checkpoint must not advance until orders barrier also lands");

  const ordersResult = await persistHistoryBarrier(
    db,
    "acct-1",
    barrierEnvelope({ stream: "orders", recordCount: 0, reachedPresent: true }),
    alwaysClosed,
  );
  assert.ok(ordersResult, "checkpoint must advance once deals+orders+positions all complete");
  assert.equal(ordersResult!.phase, "incremental");
  assert.equal(ordersResult!.completedThroughServerTime, "949276800");
  assert.ok(ordersResult!.backfillCompletedAt);
  assert.equal(checkpoints.get("acct-1").lastCompletedChunkId, "chunk-1");
});

test("persistHistoryBarrier: blocking reconstruction outcome prevents checkpoint advancement", async () => {
  const { db } = fakeDb();
  await recordDeal(db, "acct-1", "1", "pos-1", "in", 0, 1);
  const corrupted: ReconstructPositionFn = async () => ({ status: "corrupted", reason: "missing-price" });

  await persistHistoryBarrier(
    db,
    "acct-1",
    barrierEnvelope({ stream: "deals", recordCount: 1, recordsSha256: chainedDigest(["1"]) }),
    corrupted,
  );
  const result = await persistHistoryBarrier(
    db,
    "acct-1",
    barrierEnvelope({ stream: "orders", recordCount: 0 }),
    corrupted,
  );
  assert.equal(result, null, "corrupted position must block checkpoint advancement even with both wire barriers in");
});

test("persistHistoryBarrier: restart after deals commit but before the deals barrier is processed", async () => {
  const { db } = fakeDb();
  // Simulates a crash after every deal record is durably persisted but before
  // the deals-barrier message itself was consumed/acked. On restart the
  // pending barrier message is redelivered and processed for the first time.
  await recordDeal(db, "acct-1", "1", "pos-1", "in", 0, 1);
  const result = await persistHistoryBarrier(
    db,
    "acct-1",
    barrierEnvelope({ stream: "deals", recordCount: 1, recordsSha256: chainedDigest(["1"]) }),
    alwaysClosed,
  );
  assert.equal(result, null, "orders barrier hasn't landed yet");
});

test("persistHistoryBarrier: replay after restart is idempotent and does not re-advance", async () => {
  const { db, checkpoints } = fakeDb();
  await recordDeal(db, "acct-1", "1", "pos-1", "in", 0, 1);
  await persistHistoryBarrier(
    db,
    "acct-1",
    barrierEnvelope({ stream: "deals", recordCount: 1, recordsSha256: chainedDigest(["1"]) }),
    alwaysClosed,
  );
  const first = await persistHistoryBarrier(
    db,
    "acct-1",
    barrierEnvelope({ stream: "orders", recordCount: 0 }),
    alwaysClosed,
  );
  assert.ok(first);
  const checkpointAfterFirst = { ...checkpoints.get("acct-1") };

  // Replay the same (already-completed) orders barrier message.
  const replay = await persistHistoryBarrier(
    db,
    "acct-1",
    barrierEnvelope({ stream: "orders", recordCount: 0 }),
    alwaysClosed,
  );
  assert.deepEqual(replay, first, "replay of a completed chunk's barrier returns the same checkpoint, unchanged");
  assert.deepEqual(checkpoints.get("acct-1"), checkpointAfterFirst, "replay must not mutate the checkpoint again");
});
