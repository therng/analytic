import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDealHandler } from "./deal-consumer";
import { WorkerV2Status } from "./health";
import { consumeOnce } from "./stream-consumer";
import type { AccountRegistry } from "./account-registry";
import { persistHistoryBarrier, historyAckKey, nextRecordsSha256, EMPTY_RECORDS_SHA256, type RedisLike } from "./history-checkpoint";

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

// Package 3b: makeDealHandler now requires a $transaction-capable fake
// (persistHistoryRecord/persistHistoryBarrier run inside client.$transaction)
// and the chunk/ordinal/barrier envelope, not the old flat {kind, record}.
function fakeDb(overrides: Partial<any> = {}) {
  const upserted: any[] = [];
  const chunks = new Map<string, any>();
  const receipts = new Map<string, any>();
  const checkpoints = new Map<string, any>([
    [
      "acc1",
      {
        tradingAccountId: "acc1",
        phase: "backfill",
        completedThroughServerTime: 946684800n,
        dealsCursorTime: 946684800n,
        dealsCursorTicket: 0n,
        ordersCursorTime: 946684800n,
        ordersCursorTicket: 0n,
        lastCompletedChunkId: null,
        backfillCompletedAt: null,
      },
    ],
  ]);
  const db: any = {
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
    deal: {
      upsert: async (args: any) => {
        upserted.push(args);
        return {};
      },
      findMany: async () => [],
      ...overrides.deal,
    },
    order: { upsert: async () => {} },
    bridgeHistoryChunk: {
      findUnique: async ({ where }: any) => chunks.get(where.id) ?? null,
      create: async ({ data }: any) => {
        const row = {
          ...data,
          dealsAppliedCount: 0,
          ordersAppliedCount: 0,
          dealsAppliedDigest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          ordersAppliedDigest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          positionsAppliedDigest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
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
            dealsAppliedDigest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            ordersAppliedDigest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            positionsAppliedDigest: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
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
      findMany: async () => [],
      create: async ({ data }: any) => {
        receipts.set(`${data.chunkId}:${data.stream}:${data.ordinal}`, data);
        return data;
      },
    },
    _upserted: upserted,
  };
  return db;
}

const registry = new Map([
  ["1001", { id: "acc1", accountNo: "1001", brokerUtcOffsetMinutes: 180 }],
]);

function recordEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    type: "record",
    login: 1001,
    chunkId: "chunk-1",
    parentChunkId: null,
    windowStartServerTime: "946684800",
    windowEndServerTime: "949276800",
    reachedPresent: false,
    dealCursor: { time: "949276800", ticket: "0" },
    orderCursor: { time: "949276800", ticket: "0" },
    ordinal: 0,
    expectedCount: 1,
    eventKey: "55",
    payload: { ticket: 55, time: 1770000000, profit: 10 },
    payloadSha256: "a".repeat(64),
    ...overrides,
  };
}

function entry(data: unknown) {
  return { id: "1-0", message: { data: JSON.stringify(data) } };
}

test("creates a new Deal via upsert with the natural key", async () => {
  const db = fakeDb();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(db, registry as any, status);
  const outcome = await handler(entry(recordEnvelope()));
  assert.equal(outcome, "ack");
  assert.equal(db._upserted.length, 1);
  assert.equal(db._upserted[0].where.tradingAccountId_dealNo.dealNo, "55");
});

test("exact replay (same chunk/ordinal/digest) is idempotent — upsert called once, both acked", async () => {
  const db = fakeDb();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(db, registry as any, status);
  const env = recordEnvelope();
  const first = await handler(entry(env));
  const second = await handler(entry(env));
  assert.equal(first, "ack");
  assert.equal(second, "ack");
  assert.equal(db._upserted.length, 1, "replay of the identical record must not re-upsert");
});

test("login mismatch (unknown account) is acked and not upserted", async () => {
  const db = fakeDb();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(db, registry as any, status);
  const outcome = await handler(entry(recordEnvelope({ login: 9999 })));
  assert.equal(outcome, "ack");
  assert.equal(db._upserted.length, 0);
});

test("malformed record (missing ticket) is acked and not upserted", async () => {
  const db = fakeDb();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(db, registry as any, status);
  const outcome = await handler(
    entry(recordEnvelope({ eventKey: "", payload: { time: 1770000000 } })),
  );
  assert.equal(outcome, "ack");
  assert.equal(db._upserted.length, 0);
});

test("eventKey/dealNo contract violation leaves pending rather than silently corrupting position derivation", async () => {
  const db = fakeDb();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(db, registry as any, status);
  // eventKey ("999") deliberately does not match the payload's own ticket (55) -> dealNo "55".
  const outcome = await handler(entry(recordEnvelope({ eventKey: "999" })));
  assert.equal(outcome, "leave-pending");
  assert.equal(db._upserted.length, 0);
});

test("failed Prisma write leaves the entry pending (not acked)", async () => {
  const db = fakeDb({
    deal: {
      upsert: async () => {
        throw new Error("db unavailable");
      },
      findMany: async () => [],
    },
  });
  const status = new WorkerV2Status();
  const handler = makeDealHandler(db, registry as any, status);
  const outcome = await handler(entry(recordEnvelope()));
  assert.equal(outcome, "leave-pending");
});

test("barrier message on deals stream is dispatched to persistHistoryBarrier", async () => {
  const db = fakeDb();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(db, registry as any, status);
  const outcome = await handler(
    entry({
      type: "barrier",
      login: 1001,
      chunkId: "chunk-1",
      parentChunkId: null,
      windowStartServerTime: "946684800",
      windowEndServerTime: "949276800",
      reachedPresent: false,
      dealCursor: { time: "949276800", ticket: "0" },
      orderCursor: { time: "949276800", ticket: "0" },
      recordCount: 0,
      recordsSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    }),
  );
  assert.equal(outcome, "ack", "a valid barrier (orders not yet in) is acked even though checkpoint can't advance yet");
});

test("Package 4: mirror is written when the deals barrier is the one that completes the checkpoint", async () => {
  const db = fakeDb();
  const { redis, kv } = fakeRedis();
  // Pre-stamp the orders barrier directly (order-consumer.ts's own job in
  // production) so the deals barrier below is the one that completes all
  // three gates and triggers the mirror write.
  await persistHistoryBarrier(
    db,
    "acc1",
    {
      stream: "orders",
      chunkId: "chunk-1",
      parentChunkId: null,
      windowStartServerTime: "946684800",
      windowEndServerTime: "949276800",
      reachedPresent: true,
      dealCursor: { time: "949276800", ticket: "0" },
      orderCursor: { time: "949276800", ticket: "0" },
      recordCount: 0,
      recordsSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    async () => ({ status: "closed" }),
  );

  const status = new WorkerV2Status();
  const handler = makeDealHandler(db, registry as any, status, redis);
  await handler(entry(recordEnvelope({ reachedPresent: true })));
  const outcome = await handler(
    entry({
      type: "barrier",
      login: 1001,
      chunkId: "chunk-1",
      parentChunkId: null,
      windowStartServerTime: "946684800",
      windowEndServerTime: "949276800",
      reachedPresent: true,
      dealCursor: { time: "949276800", ticket: "0" },
      orderCursor: { time: "949276800", ticket: "0" },
      recordCount: 1,
      recordsSha256: nextRecordsSha256(EMPTY_RECORDS_SHA256, "a".repeat(64)),
    }),
  );
  assert.equal(outcome, "ack");
  assert.equal(kv.has(historyAckKey("1001")), true, "mirror must be written once the checkpoint actually advances");
});

test("makeDealHandler works unchanged when redis is omitted (no mirror write attempted)", async () => {
  const db = fakeDb();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(db, registry as any, status); // no redis arg
  const outcome = await handler(entry(recordEnvelope()));
  assert.equal(outcome, "ack");
});

test("failure processing account A's deal does not stop account B's deal in the same batch", async () => {
  const twoAccountRegistry = new Map([
    ["1001", { id: "acc1", accountNo: "1001", brokerUtcOffsetMinutes: 180 }],
    ["1002", { id: "acc2", accountNo: "1002", brokerUtcOffsetMinutes: 180 }],
  ]);
  const upserted: any[] = [];
  const db = fakeDb({
    deal: {
      upsert: async (args: any) => {
        if (args.where.tradingAccountId_dealNo.tradingAccountId === "acc1") {
          throw new Error("db unavailable for account A");
        }
        upserted.push(args);
        return {};
      },
      findMany: async () => [],
    },
  });
  const status = new WorkerV2Status();
  const handler = makeDealHandler(db, twoAccountRegistry as any, status);

  const acked: string[] = [];
  const redis = {
    xReadGroup: async () => [
      {
        name: "mt5:v2:history:deals",
        messages: [
          {
            id: "a-1",
            message: {
              data: JSON.stringify(
                recordEnvelope({ login: 1001, chunkId: "chunk-a", eventKey: "1", payload: { ticket: 1, time: 1770000000, profit: 1 } }),
              ),
            },
          },
          {
            id: "b-1",
            message: {
              data: JSON.stringify(
                recordEnvelope({ login: 1002, chunkId: "chunk-b", eventKey: "2", payload: { ticket: 2, time: 1770000000, profit: 2 } }),
              ),
            },
          },
        ],
      },
    ],
    xAck: async (_key: string, _group: string, id: string) => {
      acked.push(id);
      return 1;
    },
  };

  const count = await consumeOnce(redis, "mt5:v2:history:deals", "consumer-1", 50, 100, handler);

  assert.equal(count, 2, "both entries in the batch were dispatched to the handler");
  assert.deepEqual(acked, ["b-1"], "account B's entry acked despite account A's Prisma failure in the same batch");
  assert.equal(upserted.length, 1);
  assert.equal(upserted[0].where.tradingAccountId_dealNo.tradingAccountId, "acc2", "account B's deal was persisted");
});

test("net P/L is computed via Decimal ops (profit+swap+commission+fee), verifiable via mapper output composition", async () => {
  const db = fakeDb();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(db, registry as any, status);
  await handler(
    entry(
      recordEnvelope({
        payload: { ticket: 55, time: 1770000000, profit: 10, swap: -1, commission: -2, fee: 0.5 },
      }),
    ),
  );
  const written = db._upserted[0].create;
  const net = written.profit.plus(written.swap).plus(written.commission).plus(written.fee);
  assert.equal(net.toString(), "7.5");
});

test("makeDealHandler leaves pending on valid deal for account with null offset (no write, no ack)", async () => {
  const nullOffsetRegistry: AccountRegistry = new Map([
    ["1002", { id: "a2", accountNo: "1002", brokerUtcOffsetMinutes: null } as any],
  ]);
  const db = fakeDb({
    deal: {
      upsert: async () => {
        throw new Error("must not write");
      },
      findMany: async () => [],
    },
  });
  const status = { recordFailure: () => {}, recordDealProcessed: () => {} } as any;
  const handler = makeDealHandler(db, nullOffsetRegistry, status);
  const outcome = await handler(entry(recordEnvelope({ login: "1002" })));
  assert.equal(outcome, "leave-pending");
});

test("makeDealHandler persists and acks once registry refresh supplies the offset", async () => {
  const offsetRegistry: AccountRegistry = new Map([
    ["1002", { id: "a2", accountNo: "1002", brokerUtcOffsetMinutes: 180 } as any],
  ]);
  const db = fakeDb();
  const status = { recordFailure: () => {}, recordDealProcessed: () => {} } as any;
  const handler = makeDealHandler(db, offsetRegistry, status);
  const outcome = await handler(entry(recordEnvelope({ login: "1002" })));
  assert.equal(outcome, "ack");
  assert.equal(db._upserted.length, 1);
});
