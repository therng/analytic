import assert from "node:assert/strict";
import test from "node:test";
import { buildRecordEnvelope } from "./bridge-protocol";
import {
  applyHistoryBarrier,
  createInitialHistoryCheckpoint,
  EMPTY_RECORDS_SHA256,
  mirrorHistoryCheckpoint,
  normalizeReconstructionState,
  persistHistoryRecord,
  persistHistoryBarrier,
  type HistoryBarrier,
  type HistoryCheckpoint,
} from "./history-checkpoint";

function barrier(
  stream: HistoryBarrier["stream"],
  overrides: Partial<HistoryBarrier> = {},
): HistoryBarrier {
  return {
    version: 1,
    type: "barrier",
    accountNo: "acct-1",
    stream,
    chunkId: "chunk-1",
    parentChunkId: null,
    windowStartServerTime: "946684800",
    windowEndServerTime: "949276800",
    recordCount: 0,
    recordsSha256:
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    dealCursor: { time: "946684800", ticket: "0" },
    orderCursor: { time: "946684800", ticket: "0" },
    reachedPresent: false,
    reconstructionState: null,
    ...overrides,
  };
}

test("initial checkpoint starts incomplete backfill at 2000-01-01", () => {
  const checkpoint = createInitialHistoryCheckpoint("acct-1");
  assert.equal(checkpoint.phase, "backfill");
  assert.equal(checkpoint.completedThroughServerTime, "946684800");
  assert.equal(checkpoint.backfillCompletedAt, null);
});

test("one or two barriers cannot advance checkpoint", async () => {
  const state: { checkpoint: HistoryCheckpoint | null } = {
    checkpoint: createInitialHistoryCheckpoint("acct-1"),
  };
  await applyHistoryBarrier(state, barrier("deals"));
  await applyHistoryBarrier(state, barrier("orders"));
  assert.equal(state.checkpoint?.lastCompletedChunkId, null);
});

test("three empty barriers advance coverage and switch phase when at present", async () => {
  const state: { checkpoint: HistoryCheckpoint | null } = {
    checkpoint: createInitialHistoryCheckpoint("acct-1"),
  };
  const common = { reachedPresent: true };
  await applyHistoryBarrier(state, barrier("deals", common));
  await applyHistoryBarrier(state, barrier("orders", common));
  await applyHistoryBarrier(state, barrier("position-closed", common));
  assert.equal(state.checkpoint?.lastCompletedChunkId, "chunk-1");
  assert.equal(state.checkpoint?.completedThroughServerTime, "949276800");
  assert.equal(state.checkpoint?.phase, "incremental");
  const completedAt = state.checkpoint?.backfillCompletedAt;
  await applyHistoryBarrier(state, barrier("position-closed", common));
  assert.equal(state.checkpoint?.backfillCompletedAt, completedAt);
});

test("reconstruction checkpoint preserves MetaTrader UTC epochs and audit fields", () => {
  const normalized = normalizeReconstructionState(
    {
      pending: { "101": [{ ticket: 1, time: 1_751_000_000 }] },
      volumes: { "101": 0.1 },
      orders: {
        "10": {
          ticket: 10,
          time_setup: 1_751_000_000,
          time_done: 1_751_000_060,
        },
      },
    },
    180,
  ) as any;

  assert.equal(normalized.pending["101"][0].time, 1_751_000_000);
  assert.equal(
    normalized.pending["101"][0].timeUtc,
    "2025-06-27T04:53:20.000Z",
  );
  assert.equal(normalized.orders["10"].time_setup, 1_751_000_000);
  assert.equal(
    normalized.orders["10"].timeSetupUtc,
    "2025-06-27T04:53:20.000Z",
  );
  assert.equal(normalized.orders["10"].timeDoneUtc, "2025-06-27T04:54:20.000Z");
});

test("gap barrier fails without regressing or advancing checkpoint", async () => {
  const state: { checkpoint: HistoryCheckpoint | null } = {
    checkpoint: createInitialHistoryCheckpoint("acct-1"),
  };
  await assert.rejects(() =>
    applyHistoryBarrier(
      state,
      barrier("deals", {
        windowStartServerTime: "949276801",
      }),
    ),
  );
  assert.equal(state.checkpoint?.completedThroughServerTime, "946684800");
});

function fakeDb() {
  const chunks = new Map<string, any>();
  const initialCheckpoint: any = {
    tradingAccountId: "acct-1",
    phase: "backfill",
    completedThroughServerTime: 946684800n,
    dealsCursorTime: 946684800n,
    dealsCursorTicket: 0n,
    ordersCursorTime: 946684800n,
    ordersCursorTicket: 0n,
    reconstructionState: null,
    lastCompletedChunkId: null,
    backfillCompletedAt: null,
  };
  const checkpoints = new Map<string, any>([["acct-1", initialCheckpoint]]);
  const db: any = {
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
    bridgeHistoryChunk: {
      findUnique: async ({ where }: any) => chunks.get(where.id) ?? null,
      create: async ({ data }: any) => {
        const row = {
          ...data,
          dealsAppliedCount: 0,
          ordersAppliedCount: 0,
          positionsAppliedCount: 0,
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
      findUnique: async ({ where }: any) =>
        checkpoints.get(where.tradingAccountId) ?? null,
      update: async ({ where, data }: any) => {
        const checkpoint = {
          ...checkpoints.get(where.tradingAccountId),
          ...data,
        };
        checkpoints.set(where.tradingAccountId, checkpoint);
        return checkpoint;
      },
    },
    bridgeHistoryRecord: {
      findUnique: async ({ where }: any) => {
        const key = where.chunkId_stream_ordinal;
        return (
          (db.receipts ?? new Map()).get(
            `${key.chunkId}:${key.stream}:${key.ordinal}`,
          ) ?? null
        );
      },
      create: async ({ data }: any) => {
        if (!db.receipts) db.receipts = new Map();
        db.receipts.set(`${data.chunkId}:${data.stream}:${data.ordinal}`, data);
        return data;
      },
    },
    deal: { upsert: async () => undefined },
    order: { upsert: async () => undefined },
    position: { upsert: async () => undefined },
    closedPosition: { upsert: async () => undefined },
  };
  return {
    db,
    chunks,
    addCheckpoint(accountId: string) {
      checkpoints.set(accountId, {
        ...initialCheckpoint,
        tradingAccountId: accountId,
      });
    },
    checkpointFor(accountId: string) {
      return checkpoints.get(accountId);
    },
    get checkpoint() {
      return checkpoints.get("acct-1");
    },
  };
}

test("persistHistoryBarrier commits empty chunk only after all three stream barriers", async () => {
  const { db, checkpoint } = fakeDb();
  const common = { reachedPresent: true };
  await persistHistoryBarrier(db, "acct-1", barrier("deals", common), 0);
  await persistHistoryBarrier(db, "acct-1", barrier("orders", common), 0);
  assert.equal(checkpoint.lastCompletedChunkId, null);
  const committed = await persistHistoryBarrier(
    db,
    "acct-1",
    barrier("position-closed", common),
    0,
  );
  assert.equal(committed?.lastCompletedChunkId, "chunk-1");
  assert.equal(committed?.completedThroughServerTime, "949276800");
  assert.equal(committed?.phase, "incremental");
  const replay = await persistHistoryBarrier(
    db,
    "acct-1",
    barrier("position-closed", common),
    0,
  );
  assert.equal(replay?.lastCompletedChunkId, "chunk-1");
});

test("same transport chunk ID advances independent account checkpoints", async () => {
  const fixture = fakeDb();
  fixture.addCheckpoint("acct-2");

  for (const stream of ["deals", "orders", "position-closed"] as const) {
    await persistHistoryBarrier(fixture.db, "acct-1", barrier(stream), 0);
  }
  for (const stream of ["deals", "orders", "position-closed"] as const) {
    await persistHistoryBarrier(
      fixture.db,
      "acct-2",
      barrier(stream, { accountNo: "acct-2" }),
      0,
    );
  }

  assert.equal(fixture.checkpointFor("acct-1").lastCompletedChunkId, "chunk-1");
  assert.equal(fixture.checkpointFor("acct-2").lastCompletedChunkId, "chunk-1");
  assert.equal(fixture.chunks.size, 2);
});

test("parent chunk IDs are account-scoped while null stays null", async () => {
  const fixture = fakeDb();
  fixture.addCheckpoint("acct-2");

  for (const accountId of ["acct-1", "acct-2"]) {
    for (const stream of ["deals", "orders", "position-closed"] as const) {
      await persistHistoryBarrier(
        fixture.db,
        accountId,
        barrier(stream, { accountNo: accountId, chunkId: "chunk-0" }),
        0,
      );
    }
    for (const stream of ["deals", "orders", "position-closed"] as const) {
      await persistHistoryBarrier(
        fixture.db,
        accountId,
        barrier(stream, {
          accountNo: accountId,
          chunkId: "chunk-1",
          parentChunkId: "chunk-0",
          windowStartServerTime: "949276800",
          windowEndServerTime: "951868800",
        }),
        0,
      );
    }
  }

  assert.equal(fixture.chunks.get("acct-1:chunk-0").parentChunkId, null);
  assert.equal(fixture.chunks.get("acct-2:chunk-0").parentChunkId, null);
  assert.equal(
    fixture.chunks.get("acct-1:chunk-1").parentChunkId,
    "acct-1:chunk-0",
  );
  assert.equal(
    fixture.chunks.get("acct-2:chunk-1").parentChunkId,
    "acct-2:chunk-0",
  );
  assert.notEqual(
    fixture.chunks.get("acct-1:chunk-1").parentChunkId,
    fixture.chunks.get("acct-2:chunk-1").parentChunkId,
  );

  const wrongParent = {
    accountNo: "acct-1",
    chunkId: "chunk-2",
    parentChunkId: "wrong-parent",
    windowStartServerTime: "951868800",
    windowEndServerTime: "954460800",
  };
  await persistHistoryBarrier(
    fixture.db,
    "acct-1",
    barrier("deals", wrongParent),
    0,
  );
  await persistHistoryBarrier(
    fixture.db,
    "acct-1",
    barrier("orders", wrongParent),
    0,
  );
  await assert.rejects(
    persistHistoryBarrier(
      fixture.db,
      "acct-1",
      barrier("position-closed", wrongParent),
      0,
    ),
    /history checkpoint parent fork/,
  );
});

test("completed database checkpoint can rebuild a lost Redis acknowledgement on barrier replay", async () => {
  const { db } = fakeDb();
  await persistHistoryBarrier(db, "acct-1", barrier("deals"), 0, "1-0");
  await persistHistoryBarrier(db, "acct-1", barrier("orders"), 0, "2-0");
  await persistHistoryBarrier(
    db,
    "acct-1",
    barrier("position-closed"),
    0,
    "3-0",
  );

  const recovered = await persistHistoryBarrier(
    db,
    "acct-1",
    barrier("position-closed"),
    0,
    "4-0",
  );

  assert.equal(recovered?.lastCompletedChunkId, "chunk-1");
  assert.equal(recovered?.barrierRedisIds?.["position-closed"], "4-0");
});

test("digest mismatch after one stream barrier cannot advance durable checkpoint", async () => {
  const fixture = fakeDb();
  await persistHistoryBarrier(fixture.db, "acct-1", barrier("deals"), 0);

  await assert.rejects(
    persistHistoryBarrier(
      fixture.db,
      "acct-1",
      barrier("orders", {
        recordsSha256: "0".repeat(64),
      }),
      0,
    ),
    /count\/digest mismatch/,
  );
  assert.equal(fixture.checkpoint.lastCompletedChunkId, null);
  assert.equal(
    String(fixture.checkpoint.completedThroughServerTime),
    "946684800",
  );
});

test("count mismatch cannot record barrier or advance checkpoint", async () => {
  const fixture = fakeDb();
  await assert.rejects(
    persistHistoryBarrier(
      fixture.db,
      "acct-1",
      barrier("deals", { recordCount: 1 }),
      0,
    ),
    /count\/digest mismatch/,
  );
  assert.equal(fixture.checkpoint.lastCompletedChunkId, null);
});

test("automatic record persists idempotently before its barrier", async () => {
  const fixture = fakeDb();
  const { db } = fixture;
  let dealWrites = 0;
  db.deal.upsert = async () => {
    dealWrites += 1;
  };
  const envelope = buildRecordEnvelope({
    accountNo: "acct-1",
    stream: "deals",
    chunkId: "chunk-1",
    parentChunkId: "parent-0",
    windowStartServerTime: "946684800",
    windowEndServerTime: "949276800",
    ordinal: 0,
    expectedCount: 1,
    dealCursor: { time: "946684800", ticket: "1" },
    orderCursor: { time: "946684800", ticket: "0" },
    eventKey: "deal:1",
    payload: {
      ticket: 1,
      order: 2,
      positionId: null,
      symbol: "EURUSD",
      type: "buy",
      volume: 0.1,
      price: 1.1,
      commission: 0,
      fee: 0,
      swap: 0,
      profit: 1,
      balanceAfter: 1001,
      time: 946684800,
      comment: "",
    },
  });
  await persistHistoryRecord(db, "acct-1", "acct-1", "deals", envelope, 0);
  await persistHistoryRecord(db, "acct-1", "acct-1", "deals", envelope, 0);
  assert.equal(
    fixture.chunks.get("acct-1:chunk-1").parentChunkId,
    "acct-1:parent-0",
  );
  assert.equal(dealWrites, 1);
  await assert.rejects(
    () =>
      persistHistoryRecord(
        db,
        "acct-1",
        "acct-1",
        "deals",
        { ...envelope, eventKey: "deal:other", payloadSha256: "0".repeat(64) },
        0,
      ),
    /digest conflict/,
  );
  await assert.rejects(() =>
    persistHistoryRecord(
      db,
      "acct-1",
      "acct-1",
      "deals",
      { ...envelope, ordinal: 2 },
      0,
    ),
  );
});

test("closed-position reconstruction writes identical MetaTrader UTC dates to Position and ClosedPosition", async () => {
  const { db } = fakeDb();
  let positionArgs: any;
  let closedArgs: any;
  db.position.upsert = async (args: any) => {
    positionArgs = args;
  };
  db.closedPosition.upsert = async (args: any) => {
    closedArgs = args;
  };
  const envelope = buildRecordEnvelope({
    accountNo: "123",
    stream: "position-closed",
    chunkId: "position-chunk",
    parentChunkId: null,
    windowStartServerTime: "946684800",
    windowEndServerTime: "949276800",
    dealCursor: { time: "946684900", ticket: "7" },
    orderCursor: { time: "946684950", ticket: "8" },
    ordinal: 0,
    expectedCount: 1,
    eventKey: "position:9",
    payload: {
      ticket: 9,
      symbol: "EURUSD",
      positionType: 0,
      volume: 0.1,
      entryPrice: 1.1,
      exitPrice: 1.2,
      entryTime: 946684900,
      exitTime: 946685000,
      durationSeconds: 100,
      mae: -1,
      mfe: 2,
      profit: 10,
      commission: -1,
      swap: 0,
      dealTicket: 7,
      orderTicket: 8,
      comment: "",
    },
  });

  await persistHistoryRecord(
    db,
    "acct-1",
    "123",
    "position-closed",
    envelope,
    180,
  );

  assert.equal(
    positionArgs.create.openTime.toISOString(),
    "2000-01-01T00:01:40.000Z",
  );
  assert.equal(
    positionArgs.create.closeTime.toISOString(),
    "2000-01-01T00:03:20.000Z",
  );
  assert.equal(
    closedArgs.create.open_time.toISOString(),
    positionArgs.create.openTime.toISOString(),
  );
  assert.equal(
    closedArgs.create.close_time.toISOString(),
    positionArgs.create.closeTime.toISOString(),
  );
});

test("durable mirror writes ack and compatibility cursor together", async () => {
  const calls: string[] = [];
  const redis = {
    multi() {
      return {
        set(key: string) {
          calls.push(`set:${key}`);
          return this;
        },
        exec() {
          calls.push("exec");
          return Promise.resolve([]);
        },
      };
    },
  };
  await mirrorHistoryCheckpoint(redis, "123", {
    accountId: "acct-1",
    phase: "incremental",
    completedThroughServerTime: "949276800",
    dealsCursor: { time: "949276800", ticket: "10" },
    ordersCursor: { time: "949276800", ticket: "20" },
    reconstructionState: null,
    lastCompletedChunkId: "chunk-1",
    backfillCompletedAt: "2026-07-13T00:00:00.000Z",
  });
  assert.deepEqual(calls, [
    "set:mt5:bridge:history-ack:123",
    "set:mt5:bridge:history-cursor:123",
    "exec",
  ]);
});

test("durable PostgreSQL checkpoint rebuilds both Redis mirrors after Redis flush", async () => {
  const values = new Map<string, string>();
  const redis = {
    multi() {
      const writes: Array<[string, string]> = [];
      return {
        set(key: string, value: string) {
          writes.push([key, value]);
          return this;
        },
        async exec() {
          for (const [key, value] of writes) values.set(key, value);
          return [];
        },
      };
    },
  };
  const checkpoint = {
    accountId: "acct-1",
    phase: "incremental" as const,
    completedThroughServerTime: "949276800",
    dealsCursor: { time: "949276700", ticket: "10" },
    ordersCursor: { time: "949276710", ticket: "20" },
    reconstructionState: null,
    lastCompletedChunkId: "chunk-1",
    backfillCompletedAt: "2026-07-13T00:00:00.000Z",
  };
  await mirrorHistoryCheckpoint(redis, "123", checkpoint);
  values.clear();

  await mirrorHistoryCheckpoint(redis, "123", checkpoint);

  assert.equal(
    JSON.parse(values.get("mt5:bridge:history-ack:123")!).lastCompletedChunkId,
    "chunk-1",
  );
  assert.deepEqual(JSON.parse(values.get("mt5:bridge:history-cursor:123")!), {
    deals: checkpoint.dealsCursor,
    orders: checkpoint.ordersCursor,
  });
});
