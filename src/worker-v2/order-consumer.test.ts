import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOrderHandler } from "./order-consumer";
import { WorkerV2Status } from "./health";

function fakePrisma(overrides: Partial<any> = {}) {
  const upserted: any[] = [];
  return {
    order: {
      upsert: async (args: any) => {
        upserted.push(args);
        return {};
      },
      ...overrides.order,
    },
    _upserted: upserted,
  };
}

const registry = new Map([["1001", { id: "acc1", accountNo: "1001", brokerUtcOffsetMinutes: 180 }]]);

function entry(data: unknown) {
  return { id: "1-0", message: { data: JSON.stringify(data) } };
}

test("creates a new Order via upsert with the natural key", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeOrderHandler(prisma as any, registry as any, status);
  const outcome = await handler(entry({ login: 1001, kind: "order", record: { ticket: 77, time_setup: 1770000000, sl: 1.1, tp: 1.2, position_id: 800 } }));
  assert.equal(outcome, "ack");
  assert.equal(prisma._upserted[0].where.tradingAccountId_orderTicket.orderTicket, "77");
  assert.equal(prisma._upserted[0].create.sl.toString(), "1.1");
  assert.equal(prisma._upserted[0].create.positionId, "800");
});

test("redelivery updates the same order ticket, no duplicate rows", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeOrderHandler(prisma as any, registry as any, status);
  await handler(entry({ login: 1001, kind: "order", record: { ticket: 77, time_setup: 1770000000 } }));
  await handler(entry({ login: 1001, kind: "order", record: { ticket: 77, time_setup: 1770000000, state: "FILLED" } }));
  assert.equal(prisma._upserted.length, 2);
  assert.equal(prisma._upserted[1].where.tradingAccountId_orderTicket.orderTicket, "77");
});

test("malformed timestamp is rejected and not upserted", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeOrderHandler(prisma as any, registry as any, status);
  const outcome = await handler(entry({ login: 1001, kind: "order", record: { ticket: 77 } }));
  assert.equal(outcome, "ack");
  assert.equal(prisma._upserted.length, 0);
});

test("failed database write is not acknowledged", async () => {
  const prisma = fakePrisma({ order: { upsert: async () => { throw new Error("db unavailable"); } } });
  const status = new WorkerV2Status();
  const handler = makeOrderHandler(prisma as any, registry as any, status);
  const outcome = await handler(entry({ login: 1001, kind: "order", record: { ticket: 77, time_setup: 1770000000 } }));
  assert.equal(outcome, "leave-pending");
});
