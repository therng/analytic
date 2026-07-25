import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_RECORDS_SHA256,
  ensureHistoryCheckpoint,
  persistHistoryRecord,
  type HistoryRecordEnvelope,
} from "./history-checkpoint";

function fakeDb() {
  const chunks = new Map<string, any>();
  const receipts = new Map<string, any>();
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
    deal: { upsert: async () => {} },
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
      create: async ({ data }: any) => {
        receipts.set(`${data.chunkId}:${data.stream}:${data.ordinal}`, data);
        return data;
      },
    },
  };
  return { db, chunks, checkpoints, receipts };
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
    eventKey: "deal:1",
    payloadSha256: "a".repeat(64),
    ...overrides,
  };
}

test("ensureHistoryCheckpoint creates initial checkpoint at 2000-01-01 backfill phase", async () => {
  const { db } = fakeDb();
  db.bridgeHistoryCheckpoint.findUnique = async () => null;
  const checkpoint = await ensureHistoryCheckpoint(db, "acct-2");
  assert.equal(checkpoint.phase, "backfill");
  assert.equal(checkpoint.completedThroughServerTime, "946684800");
  assert.equal(checkpoint.backfillCompletedAt, null);
});

test("ensureHistoryCheckpoint returns existing checkpoint unchanged", async () => {
  const { db } = fakeDb();
  const checkpoint = await ensureHistoryCheckpoint(db, "acct-1");
  assert.equal(checkpoint.phase, "backfill");
  assert.equal(checkpoint.accountId, "acct-1");
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
        { ...env, eventKey: "deal:other", payloadSha256: "b".repeat(64) },
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
  await persistHistoryRecord(db, "acct-2", "deals", envelope({ eventKey: "deal:acct2" }), async () => {});
  assert.ok(chunks.has("acct-1:chunk-1"));
  assert.ok(chunks.has("acct-2:chunk-1"));
  assert.equal(chunks.get("acct-1:chunk-1").dealsAppliedCount, 1);
  assert.equal(chunks.get("acct-2:chunk-1").dealsAppliedCount, 1);
});
