import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDealHandler } from "./deal-consumer";
import { WorkerV2Status } from "./health";

function fakePrisma(overrides: Partial<any> = {}) {
  const upserted: any[] = [];
  return {
    deal: {
      upsert: async (args: any) => {
        upserted.push(args);
        return {};
      },
      ...overrides.deal,
    },
    _upserted: upserted,
  };
}

const registry = new Map([["1001", { id: "acc1", accountNo: "1001", brokerUtcOffsetMinutes: 180 }]]);

function entry(data: unknown) {
  return { id: "1-0", message: { data: JSON.stringify(data) } };
}

test("creates a new Deal via upsert with the natural key", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(prisma as any, registry as any, status);
  const outcome = await handler(entry({ login: 1001, kind: "deal", record: { ticket: 55, time: 1770000000, profit: 10 } }));
  assert.equal(outcome, "ack");
  assert.equal(prisma._upserted.length, 1);
  assert.equal(prisma._upserted[0].where.tradingAccountId_dealNo.dealNo, "55");
});

test("redelivery calls upsert again for the same natural key (idempotent update path)", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(prisma as any, registry as any, status);
  await handler(entry({ login: 1001, kind: "deal", record: { ticket: 55, time: 1770000000, profit: 10 } }));
  await handler(entry({ login: 1001, kind: "deal", record: { ticket: 55, time: 1770000000, profit: 11 } }));
  assert.equal(prisma._upserted.length, 2);
  assert.equal(prisma._upserted[0].where.tradingAccountId_dealNo.dealNo, prisma._upserted[1].where.tradingAccountId_dealNo.dealNo);
});

test("login mismatch (unknown account) is acked and not upserted", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(prisma as any, registry as any, status);
  const outcome = await handler(entry({ login: 9999, kind: "deal", record: { ticket: 55, time: 1770000000 } }));
  assert.equal(outcome, "ack");
  assert.equal(prisma._upserted.length, 0);
});

test("malformed record (missing ticket) is acked and not upserted", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(prisma as any, registry as any, status);
  const outcome = await handler(entry({ login: 1001, kind: "deal", record: { time: 1770000000 } }));
  assert.equal(outcome, "ack");
  assert.equal(prisma._upserted.length, 0);
});

test("failed Prisma write leaves the entry pending (not acked)", async () => {
  const prisma = fakePrisma({ deal: { upsert: async () => { throw new Error("db unavailable"); } } });
  const status = new WorkerV2Status();
  const handler = makeDealHandler(prisma as any, registry as any, status);
  const outcome = await handler(entry({ login: 1001, kind: "deal", record: { ticket: 55, time: 1770000000 } }));
  assert.equal(outcome, "leave-pending");
});

test("net P/L is computed via Decimal ops (profit+swap+commission+fee), verifiable via mapper output composition", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(prisma as any, registry as any, status);
  await handler(entry({ login: 1001, kind: "deal", record: { ticket: 55, time: 1770000000, profit: 10, swap: -1, commission: -2, fee: 0.5 } }));
  const written = prisma._upserted[0].create;
  const net = written.profit.plus(written.swap).plus(written.commission).plus(written.fee);
  assert.equal(net.toString(), "7.5");
});
