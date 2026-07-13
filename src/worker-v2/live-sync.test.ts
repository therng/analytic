// src/worker-v2/live-sync.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncAccountLive } from "./live-sync";
import { WorkerV2Status } from "./health";

const account = { id: "acc1", accountNo: "1001", brokerUtcOffsetMinutes: 180 };

function fakePrisma() {
  const deleted: any[] = [];
  const created: any[] = [];
  let snapshotUpserted: any = null;
  return {
    accountSnapshot: {
      upsert: async (args: any) => {
        snapshotUpserted = args;
        return {};
      },
    },
    openPosition: {
      deleteMany: async (args: any) => {
        deleted.push(args);
        return { count: 0 };
      },
      createMany: async (args: any) => {
        created.push(...args.data);
        return { count: args.data.length };
      },
    },
    $transaction: async (ops: Promise<any>[]) => Promise.all(ops),
    _deleted: deleted,
    _created: created,
    _snapshot: () => snapshotUpserted,
  };
}

function fakeRedis({ heartbeat, live, positions }: { heartbeat?: Record<string, string>; live?: Record<string, string>; positions?: string | null }) {
  return {
    hGetAll: async (key: string) => (key.includes("heartbeat") ? heartbeat ?? {} : live ?? {}),
    get: async () => positions ?? null,
  };
}

test("valid complete payload replaces account positions", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis({
    heartbeat: { lastSeen: "1770000000", positions: "1" },
    live: { login: "1001", balance: "1000", equity: "1000", margin: "0", margin_free: "1000", margin_level: "" },
    positions: JSON.stringify([{ ticket: 1, symbol: "EURUSD", type: 0, volume: 0.1, price_open: 1.1, price_current: 1.11, profit: 1, swap: 0 }]),
  });
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._deleted.length, 1);
  assert.equal(prisma._created.length, 1);
  assert.equal(prisma._created[0].positionNo, "1");
  assert.ok(prisma._snapshot());
});

test("empty valid payload clears positions", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis({
    heartbeat: { lastSeen: "1770000000", positions: "0" },
    live: { login: "1001", balance: "1000", equity: "1000", margin: "0", margin_free: "1000" },
    positions: "[]",
  });
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._deleted.length, 1);
  assert.equal(prisma._created.length, 0);
});

test("stale payload (missing heartbeat) does not touch positions or snapshot", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis({ heartbeat: {}, live: { login: "1001", balance: "1000", equity: "1000", margin: "0", margin_free: "1000" }, positions: "[]" });
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._deleted.length, 0);
  assert.equal(prisma._created.length, 0);
  assert.equal(prisma._snapshot(), null);
});

test("malformed positions payload does not delete existing positions, but a fresh valid snapshot still commits", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis({
    heartbeat: { lastSeen: "1770000000", positions: "1" },
    live: { login: "1001", balance: "1000", equity: "1000", margin: "0", margin_free: "1000" },
    positions: "{not json",
  });
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._deleted.length, 0);
  assert.equal(prisma._created.length, 0);
  assert.ok(prisma._snapshot());
});

test("live hash login mismatch skips both snapshot and positions", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis({
    heartbeat: { lastSeen: "1770000000", positions: "1" },
    live: { login: "9999", balance: "1000", equity: "1000", margin: "0", margin_free: "1000" },
    positions: "[]",
  });
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._deleted.length, 0);
  assert.equal(prisma._snapshot(), null);
});

test("incomplete live payload (missing required field) does not delete positions", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis({
    heartbeat: { lastSeen: "1770000000", positions: "1" },
    live: { login: "1001", balance: "1000" },
    positions: "[]",
  });
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._deleted.length, 0);
  assert.equal(prisma._snapshot(), null);
});

test("more than 100 open positions are persisted without truncation", async () => {
  const many = Array.from({ length: 150 }, (_, i) => ({ ticket: i + 1, symbol: "EURUSD", type: 0, volume: 0.1, price_open: 1.1, price_current: 1.11, profit: 1, swap: 0 }));
  const prisma = fakePrisma();
  const redis = fakeRedis({
    heartbeat: { lastSeen: "1770000000", positions: "150" },
    live: { login: "1001", balance: "1000", equity: "1000", margin: "0", margin_free: "1000" },
    positions: JSON.stringify(many),
  });
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._created.length, 150);
});

test("malformed individual position is dropped, valid siblings in the same payload still persist", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis({
    heartbeat: { lastSeen: "1770000000", positions: "3" },
    live: { login: "1001", balance: "1000", equity: "1000", margin: "0", margin_free: "1000" },
    positions: JSON.stringify([
      { ticket: 1, symbol: "EURUSD", type: 0, volume: 0.1, price_open: 1.1, price_current: 1.11, profit: 1, swap: 0 },
      { ticket: 2, symbol: "EURUSD", type: 0, volume: 0.1, price_open: 1.1, price_current: 1.11, profit: "not-a-number", swap: 0 },
      { ticket: 3, symbol: "EURUSD", type: 0, volume: 0.1, price_open: 1.1, price_current: 1.11, profit: 2, swap: 0 },
    ]),
  });
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._deleted.length, 1);
  assert.equal(prisma._created.length, 2);
  assert.equal(prisma._created[0].positionNo, "1");
  assert.equal(prisma._created[1].positionNo, "3");
});
