// src/worker-v2/live-sync.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { syncAccountLive, type LiveSyncState } from "./live-sync";
import { WorkerV2Status } from "./health";

const account = { id: "acc1", accountNo: "1001", brokerUtcOffsetMinutes: 180 };

function fakePrisma() {
  const deleted: any[] = [];
  const created: any[] = [];
  const accountUpdates: any[] = [];
  let snapshotWrites = 0;
  let snapshotUpserted: any = null;
  return {
    accountSnapshot: {
      upsert: async (args: any) => {
        snapshotWrites += 1;
        snapshotUpserted = args;
        return {};
      },
    },
    tradingAccount: {
      update: async (args: any) => {
        accountUpdates.push(args);
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
    _accountUpdates: accountUpdates,
    _snapshot: () => snapshotUpserted,
    _snapshotWrites: () => snapshotWrites,
  };
}

const OBSERVED_AT = "2026-07-31T12:00:00.000Z";

function envelope({
  login = 1001,
  observedAtUtc = OBSERVED_AT,
  accountState = "success_nonempty",
  positionsState = "success_nonempty",
  positions = [] as unknown[],
  accountRaw = {},
  digest,
}: {
  login?: number;
  observedAtUtc?: string;
  accountState?: string;
  positionsState?: string;
  positions?: unknown[];
  accountRaw?: Record<string, unknown>;
  digest?: string;
} = {}) {
  const payload = {
    account: {
      raw: {
        login,
        balance: 1000,
        equity: 1000,
        margin: 0,
        margin_free: 1000,
        margin_level: 0,
        profit: 0,
        credit: 0,
        currency: "USD",
        ...accountRaw,
      },
      state: accountState,
    },
    orders: { rows: [], state: "success_empty" },
    positions: { rows: positions, state: positionsState },
  };
  return JSON.stringify({
    schema: "mt5n.bridge.v1",
    message_type: "live.snapshot",
    observed_at_utc: observedAtUtc,
    payload_digest: digest ?? JSON.stringify(payload),
    payload,
  });
}

function fakeRedis(raw: string | null) {
  return { get: async () => raw };
}

test("valid envelope replaces account positions", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis(
    envelope({
      positions: [
        {
          ticket: 1,
          symbol: "EURUSD",
          type: 0,
          volume: 0.1,
          price_open: 1.1,
          price_current: 1.11,
          profit: 1,
          swap: 0,
        },
      ],
    }),
  );
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._deleted.length, 1);
  assert.equal(prisma._created.length, 1);
  assert.equal(prisma._created[0].positionNo, "1");
  assert.ok(prisma._snapshot());
});

test("unchanged envelope digest does not rewrite PostgreSQL on the next poll", async () => {
  const prisma = fakePrisma();
  const raw = envelope({
    positions: [
      {
        ticket: 1,
        symbol: "EURUSD",
        type: 0,
        volume: 0.1,
        price_open: 1.1,
        price_current: 1.11,
        profit: 1,
        swap: 0,
      },
    ],
  });
  const redis = fakeRedis(raw);
  const status = new WorkerV2Status();
  const state: LiveSyncState = new Map();

  await syncAccountLive(prisma as any, redis as any, account as any, status, state);
  await syncAccountLive(prisma as any, redis as any, account as any, status, state);

  assert.equal(prisma._snapshotWrites(), 1);
  assert.equal(prisma._deleted.length, 1);
  assert.equal(prisma._created.length, 1);
  // Touched once for liveness, plus once as part of the fingerprint-changed
  // write on the first call; the second (unchanged) call is within the
  // throttle window so it must not touch again.
  assert.equal(prisma._accountUpdates.length, 2);
  assert.ok(prisma._snapshot());
});

test("empty positions array clears positions", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis(envelope({ positions: [] }));
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._deleted.length, 1);
  assert.equal(prisma._created.length, 0);
});

test("a live but unchanging account still gets its TradingAccount.updatedAt touched once the throttle window elapses", async () => {
  const prisma = fakePrisma();
  const raw = envelope({ positions: [] });
  const redis = fakeRedis(raw);
  const status = new WorkerV2Status();
  const state: LiveSyncState = new Map();

  await syncAccountLive(prisma as any, redis as any, account as any, status, state);
  assert.equal(prisma._accountUpdates.length, 2);

  await syncAccountLive(prisma as any, redis as any, account as any, status, state);
  assert.equal(prisma._accountUpdates.length, 2);

  state.get(account.accountNo)!.lastTouchedAt = Date.now() - 11 * 60 * 1000;
  await syncAccountLive(prisma as any, redis as any, account as any, status, state);
  assert.equal(prisma._accountUpdates.length, 3);
});

test("missing live key does not touch positions or snapshot", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis(null);
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._deleted.length, 0);
  assert.equal(prisma._created.length, 0);
  assert.equal(prisma._snapshot(), null);
});

test("malformed JSON envelope is skipped", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis("{not json");
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._snapshot(), null);
});

test("wrong schema/message_type envelope is skipped", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis(
    JSON.stringify({ schema: "mt5.v2", message_type: "live.snapshot" }),
  );
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._snapshot(), null);
});

test("failed account read state skips snapshot and positions", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis(envelope({ accountState: "failed" }));
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._deleted.length, 0);
  assert.equal(prisma._snapshot(), null);
});

test("failed positions read state skips positions but keeps snapshot", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis(envelope({ positionsState: "failed" }));
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._deleted.length, 0);
  assert.ok(prisma._snapshot());
});

test("stale observed_at_utc timestamp does not throw", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis(envelope({ observedAtUtc: "not-a-date" }));
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._snapshot(), null);
});

test("more than 100 open positions are persisted without truncation", async () => {
  const many = Array.from({ length: 150 }, (_, i) => ({
    ticket: i + 1,
    symbol: "EURUSD",
    type: 0,
    volume: 0.1,
    price_open: 1.1,
    price_current: 1.11,
    profit: 1,
    swap: 0,
  }));
  const prisma = fakePrisma();
  const redis = fakeRedis(envelope({ positions: many }));
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._created.length, 150);
});

test("malformed individual position aborts the whole replacement, leaving existing rows untouched", async () => {
  const prisma = fakePrisma();
  const redis = fakeRedis(
    envelope({
      positions: [
        {
          ticket: 1,
          symbol: "EURUSD",
          type: 0,
          volume: 0.1,
          price_open: 1.1,
          price_current: 1.11,
          profit: 1,
          swap: 0,
        },
        {
          ticket: 2,
          symbol: "EURUSD",
          type: 0,
          volume: 0.1,
          price_open: 1.1,
          price_current: 1.11,
          profit: "not-a-number",
          swap: 0,
        },
      ],
    }),
  );
  const status = new WorkerV2Status();
  await syncAccountLive(prisma as any, redis as any, account as any, status);
  assert.equal(prisma._deleted.length, 0);
  assert.equal(prisma._created.length, 0);
});

test("syncAccountLive skips entirely when account offset is null", async () => {
  const nullOffsetAccount = {
    id: "a1",
    accountNo: "1001",
    brokerUtcOffsetMinutes: null,
  } as any;
  const redis = fakeRedis(envelope());
  const prisma = {
    accountSnapshot: {
      upsert: async () => {
        throw new Error("must not write snapshot");
      },
    },
  } as any;
  const status = new WorkerV2Status();
  await syncAccountLive(prisma, redis, nullOffsetAccount, status);
});
