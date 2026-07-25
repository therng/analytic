import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOrderHandler } from "./order-consumer";
import { WorkerV2Status } from "./health";
import type { AccountRegistry } from "./account-registry";

// Package 3b: makeOrderHandler now requires a $transaction-capable fake
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
    deal: { upsert: async () => {}, findMany: async () => [] },
    order: {
      upsert: async (args: any) => {
        upserted.push(args);
        return {};
      },
      ...overrides.order,
    },
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
    eventKey: "77",
    payload: { ticket: 77, time_setup: 1770000000, sl: 1.1, tp: 1.2, position_id: 800 },
    payloadSha256: "a".repeat(64),
    ...overrides,
  };
}

function entry(data: unknown) {
  return { id: "1-0", message: { data: JSON.stringify(data) } };
}

test("creates a new Order via upsert with the natural key", async () => {
  const db = fakeDb();
  const status = new WorkerV2Status();
  const handler = makeOrderHandler(db, registry as any, status);
  const outcome = await handler(entry(recordEnvelope()));
  assert.equal(outcome, "ack");
  assert.equal(db._upserted[0].where.tradingAccountId_orderTicket.orderTicket, "77");
  assert.equal(db._upserted[0].create.sl.toString(), "1.1");
  assert.equal(db._upserted[0].create.positionId, "800");
});

test("exact replay (same chunk/ordinal/digest) is idempotent — upsert called once, both acked", async () => {
  const db = fakeDb();
  const status = new WorkerV2Status();
  const handler = makeOrderHandler(db, registry as any, status);
  const env = recordEnvelope();
  const first = await handler(entry(env));
  const second = await handler(entry(env));
  assert.equal(first, "ack");
  assert.equal(second, "ack");
  assert.equal(db._upserted.length, 1, "replay of the identical record must not re-upsert");
});

test("malformed timestamp is rejected and not upserted", async () => {
  const db = fakeDb();
  const status = new WorkerV2Status();
  const handler = makeOrderHandler(db, registry as any, status);
  const outcome = await handler(entry(recordEnvelope({ payload: { ticket: 77 } })));
  assert.equal(outcome, "ack");
  assert.equal(db._upserted.length, 0);
});

test("failed database write is not acknowledged", async () => {
  const db = fakeDb({
    order: {
      upsert: async () => {
        throw new Error("db unavailable");
      },
    },
  });
  const status = new WorkerV2Status();
  const handler = makeOrderHandler(db, registry as any, status);
  const outcome = await handler(entry(recordEnvelope()));
  assert.equal(outcome, "leave-pending");
});

test("barrier message on orders stream is dispatched to persistHistoryBarrier", async () => {
  const db = fakeDb();
  const status = new WorkerV2Status();
  const handler = makeOrderHandler(db, registry as any, status);
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
  assert.equal(outcome, "ack", "a valid barrier (deals not yet in) is acked even though checkpoint can't advance yet");
});

test("makeOrderHandler leaves pending on valid order for account with null offset (no write, no ack)", async () => {
  const nullOffsetRegistry: AccountRegistry = new Map([
    ["1002", { id: "a2", accountNo: "1002", brokerUtcOffsetMinutes: null } as any],
  ]);
  const db = fakeDb({
    order: {
      upsert: async () => {
        throw new Error("must not write");
      },
    },
  });
  const status = { recordFailure: () => {}, recordOrderProcessed: () => {} } as any;
  const handler = makeOrderHandler(db, nullOffsetRegistry, status);
  const outcome = await handler(entry(recordEnvelope({ login: "1002" })));
  assert.equal(outcome, "leave-pending");
});

test("makeOrderHandler persists and acks once registry refresh supplies the offset", async () => {
  const offsetRegistry: AccountRegistry = new Map([
    ["1002", { id: "a2", accountNo: "1002", brokerUtcOffsetMinutes: 180 } as any],
  ]);
  const db = fakeDb();
  const status = { recordFailure: () => {}, recordOrderProcessed: () => {} } as any;
  const handler = makeOrderHandler(db, offsetRegistry, status);
  const outcome = await handler(entry(recordEnvelope({ login: "1002" })));
  assert.equal(outcome, "ack");
  assert.equal(db._upserted.length, 1);
});
