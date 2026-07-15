import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDealHandler } from "./deal-consumer";
import { WorkerV2Status } from "./health";
import { consumeOnce } from "./stream-consumer";
import type { AccountRegistry } from "./account-registry";

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

const registry = new Map([
  ["1001", { id: "acc1", accountNo: "1001", brokerUtcOffsetMinutes: 180 }],
]);

function entry(data: unknown) {
  return { id: "1-0", message: { data: JSON.stringify(data) } };
}

test("creates a new Deal via upsert with the natural key", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(prisma as any, registry as any, status);
  const outcome = await handler(
    entry({
      login: 1001,
      kind: "deal",
      record: { ticket: 55, time: 1770000000, profit: 10 },
    }),
  );
  assert.equal(outcome, "ack");
  assert.equal(prisma._upserted.length, 1);
  assert.equal(prisma._upserted[0].where.tradingAccountId_dealNo.dealNo, "55");
});

test("redelivery calls upsert again for the same natural key (idempotent update path)", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(prisma as any, registry as any, status);
  await handler(
    entry({
      login: 1001,
      kind: "deal",
      record: { ticket: 55, time: 1770000000, profit: 10 },
    }),
  );
  await handler(
    entry({
      login: 1001,
      kind: "deal",
      record: { ticket: 55, time: 1770000000, profit: 11 },
    }),
  );
  assert.equal(prisma._upserted.length, 2);
  assert.equal(
    prisma._upserted[0].where.tradingAccountId_dealNo.dealNo,
    prisma._upserted[1].where.tradingAccountId_dealNo.dealNo,
  );
});

test("login mismatch (unknown account) is acked and not upserted", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(prisma as any, registry as any, status);
  const outcome = await handler(
    entry({
      login: 9999,
      kind: "deal",
      record: { ticket: 55, time: 1770000000 },
    }),
  );
  assert.equal(outcome, "ack");
  assert.equal(prisma._upserted.length, 0);
});

test("malformed record (missing ticket) is acked and not upserted", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(prisma as any, registry as any, status);
  const outcome = await handler(
    entry({ login: 1001, kind: "deal", record: { time: 1770000000 } }),
  );
  assert.equal(outcome, "ack");
  assert.equal(prisma._upserted.length, 0);
});

test("failed Prisma write leaves the entry pending (not acked)", async () => {
  const prisma = fakePrisma({
    deal: {
      upsert: async () => {
        throw new Error("db unavailable");
      },
    },
  });
  const status = new WorkerV2Status();
  const handler = makeDealHandler(prisma as any, registry as any, status);
  const outcome = await handler(
    entry({
      login: 1001,
      kind: "deal",
      record: { ticket: 55, time: 1770000000 },
    }),
  );
  assert.equal(outcome, "leave-pending");
});

test("failure processing account A's deal does not stop account B's deal in the same batch", async () => {
  const twoAccountRegistry = new Map([
    ["1001", { id: "acc1", accountNo: "1001", brokerUtcOffsetMinutes: 180 }],
    ["1002", { id: "acc2", accountNo: "1002", brokerUtcOffsetMinutes: 180 }],
  ]);
  const upserted: any[] = [];
  const prisma = {
    deal: {
      upsert: async (args: any) => {
        if (args.where.tradingAccountId_dealNo.tradingAccountId === "acc1") {
          throw new Error("db unavailable for account A");
        }
        upserted.push(args);
        return {};
      },
    },
  };
  const status = new WorkerV2Status();
  const handler = makeDealHandler(
    prisma as any,
    twoAccountRegistry as any,
    status,
  );

  const acked: string[] = [];
  const redis = {
    xReadGroup: async () => [
      {
        name: "mt5:v2:history:deals",
        messages: [
          {
            id: "a-1",
            message: {
              data: JSON.stringify({
                login: 1001,
                kind: "deal",
                record: { ticket: 1, time: 1770000000, profit: 1 },
              }),
            },
          },
          {
            id: "b-1",
            message: {
              data: JSON.stringify({
                login: 1002,
                kind: "deal",
                record: { ticket: 2, time: 1770000000, profit: 2 },
              }),
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

  const count = await consumeOnce(
    redis,
    "mt5:v2:history:deals",
    "consumer-1",
    50,
    100,
    handler,
  );

  assert.equal(
    count,
    2,
    "both entries in the batch were dispatched to the handler",
  );
  assert.deepEqual(
    acked,
    ["b-1"],
    "account B's entry acked despite account A's Prisma failure in the same batch",
  );
  assert.equal(upserted.length, 1);
  assert.equal(
    upserted[0].where.tradingAccountId_dealNo.tradingAccountId,
    "acc2",
    "account B's deal was persisted",
  );
});

test("net P/L is computed via Decimal ops (profit+swap+commission+fee), verifiable via mapper output composition", async () => {
  const prisma = fakePrisma();
  const status = new WorkerV2Status();
  const handler = makeDealHandler(prisma as any, registry as any, status);
  await handler(
    entry({
      login: 1001,
      kind: "deal",
      record: {
        ticket: 55,
        time: 1770000000,
        profit: 10,
        swap: -1,
        commission: -2,
        fee: 0.5,
      },
    }),
  );
  const written = prisma._upserted[0].create;
  const net = written.profit
    .plus(written.swap)
    .plus(written.commission)
    .plus(written.fee);
  assert.equal(net.toString(), "7.5");
});

test("makeDealHandler leaves pending on valid deal for account with null offset (no write, no ack)", async () => {
  const registry: AccountRegistry = new Map([
    [
      "1002",
      { id: "a2", accountNo: "1002", brokerUtcOffsetMinutes: null } as any,
    ],
  ]);
  const prisma = {
    deal: {
      upsert: async () => {
        throw new Error("must not write");
      },
    },
  } as any;
  const status = {
    recordFailure: () => {},
    recordDealProcessed: () => {},
  } as any;
  const handler = makeDealHandler(prisma, registry, status);
  const entry = {
    id: "1-1",
    message: {
      data: JSON.stringify({
        kind: "deal",
        login: "1002",
        record: { ticket: "5", time: 1700000000 },
      }),
    },
  };
  const outcome = await handler(entry);
  assert.equal(outcome, "leave-pending");
});

test("makeDealHandler persists and acks once registry refresh supplies the offset", async () => {
  const registry: AccountRegistry = new Map([
    [
      "1002",
      { id: "a2", accountNo: "1002", brokerUtcOffsetMinutes: 180 } as any,
    ],
  ]);
  let wrote = false;
  const prisma = {
    deal: {
      upsert: async () => {
        wrote = true;
      },
    },
  } as any;
  const status = {
    recordFailure: () => {},
    recordDealProcessed: () => {},
  } as any;
  const handler = makeDealHandler(prisma, registry, status);
  const entry = {
    id: "1-1",
    message: {
      data: JSON.stringify({
        kind: "deal",
        login: "1002",
        record: { ticket: "5", time: 1700000000 },
      }),
    },
  };
  const outcome = await handler(entry);
  assert.equal(outcome, "ack");
  assert.equal(wrote, true);
});
