import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeHistoryHandler,
  historyStreamKey,
} from "./history-consumer";
import { WorkerV2Status } from "./health";
import { reclaimPending } from "./stream-consumer";
import type { AccountRegistry } from "./account-registry";

function fakeDb() {
  const deals = new Map<string, any>();
  const orders = new Map<string, any>();
  const positions = new Map<string, any>();
  const db: any = {
    $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(db),
    deal: {
      upsert: async ({ where, create }: any) => {
        deals.set(where.tradingAccountId_dealNo.tradingAccountId + ":" + where.tradingAccountId_dealNo.dealNo, create);
        return create;
      },
      findMany: async ({ where }: any) =>
        [...deals.values()].filter(
          (d) =>
            d.tradingAccountId === where.tradingAccountId &&
            d.positionId === where.positionId,
        ),
    },
    order: {
      upsert: async ({ where, create }: any) => {
        orders.set(
          where.tradingAccountId_orderTicket.tradingAccountId +
            ":" +
            where.tradingAccountId_orderTicket.orderTicket,
          create,
        );
        return create;
      },
    },
    position: {
      upsert: async ({ where, create }: any) => {
        positions.set(
          where.tradingAccountId_positionNo.tradingAccountId +
            ":" +
            where.tradingAccountId_positionNo.positionNo,
          create,
        );
        return create;
      },
    },
    positionExcursion: {
      aggregate: async () => ({ _min: { profit: null }, _max: { profit: null } }),
    },
    _deals: deals,
    _orders: orders,
    _positions: positions,
  };
  return db;
}

function registryWith(...accounts: Array<{ accountNo: string; id: string; brokerUtcOffsetMinutes: number | null }>) {
  const registry: AccountRegistry = new Map();
  for (const a of accounts) registry.set(a.accountNo, a as any);
  return registry;
}

const ACCOUNT = { id: "acc1", accountNo: "1001", brokerUtcOffsetMinutes: 180 };

function envelope(messageType: string, login: number, raw: Record<string, unknown>) {
  return JSON.stringify({
    schema: "mt5n.bridge.v1",
    message_type: messageType,
    account: { login },
    payload: { raw },
  });
}

function entry(id: string, json: string) {
  return { id, message: { event_id: id, envelope: json } };
}

test("historyStreamKey uses the native braced per-account contract, not bridge_v2", () => {
  assert.equal(historyStreamKey("1001"), "mt5:account:{1001}:stream:history");
  assert.doesNotMatch(historyStreamKey("1001"), /mt5:v2/);
});

test("history.deal envelope upserts Deal and acks", async () => {
  const db = fakeDb();
  const registry = registryWith(ACCOUNT);
  const status = new WorkerV2Status();
  const handler = makeHistoryHandler(db, registry, status);

  const outcome = await handler(
    entry(
      "1-0",
      envelope("history.deal", 1001, {
        ticket: 501,
        time: 1735689600,
        symbol: "EURUSD",
        volume: 0.1,
        price: 1.1,
        profit: 10,
        swap: 0,
        commission: 0,
      }),
    ),
  );

  assert.equal(outcome, "ack");
  assert.ok(db._deals.get("acc1:501"));
});

test("history.order envelope upserts Order and acks", async () => {
  const db = fakeDb();
  const registry = registryWith(ACCOUNT);
  const status = new WorkerV2Status();
  const handler = makeHistoryHandler(db, registry, status);

  const outcome = await handler(
    entry(
      "1-0",
      envelope("history.order", 1001, {
        ticket: 900,
        time_setup: 1735689500,
        time_done: 1735689600,
        symbol: "EURUSD",
      }),
    ),
  );

  assert.equal(outcome, "ack");
  assert.ok(db._orders.get("acc1:900"));
});

test("history.window is acked as a no-op boundary marker, no Postgres write", async () => {
  const db = fakeDb();
  const registry = registryWith(ACCOUNT);
  const status = new WorkerV2Status();
  const handler = makeHistoryHandler(db, registry, status);

  const outcome = await handler(
    entry(
      "1-0",
      JSON.stringify({
        schema: "mt5n.bridge.v1",
        message_type: "history.window",
        account: { login: 1001 },
        payload: { window_id: "w1", deal_count: 0, order_count: 0 },
      }),
    ),
  );

  assert.equal(outcome, "ack");
  assert.equal(db._deals.size, 0);
  assert.equal(db._orders.size, 0);
});

test("duplicate replay of the same deal event is idempotent", async () => {
  const db = fakeDb();
  const registry = registryWith(ACCOUNT);
  const status = new WorkerV2Status();
  const handler = makeHistoryHandler(db, registry, status);
  const raw = envelope("history.deal", 1001, {
    ticket: 501,
    time: 1735689600,
    symbol: "EURUSD",
    volume: 0.1,
    price: 1.1,
    profit: 10,
    swap: 0,
    commission: 0,
  });

  await handler(entry("1-0", raw));
  await handler(entry("1-1", raw));

  assert.equal(db._deals.size, 1);
});

test("failed DB write returns leave-pending, never acks", async () => {
  const db = fakeDb();
  db.deal.upsert = async () => {
    throw new Error("connection reset");
  };
  const registry = registryWith(ACCOUNT);
  const status = new WorkerV2Status();
  const handler = makeHistoryHandler(db, registry, status);

  const outcome = await handler(
    entry(
      "1-0",
      envelope("history.deal", 1001, {
        ticket: 501,
        time: 1735689600,
        symbol: "EURUSD",
      }),
    ),
  );

  assert.equal(outcome, "leave-pending");
  assert.equal(db._deals.size, 0);
});

test("malformed envelope JSON is acked (dead letter, not retried forever)", async () => {
  const db = fakeDb();
  const registry = registryWith(ACCOUNT);
  const status = new WorkerV2Status();
  const handler = makeHistoryHandler(db, registry, status);

  const outcome = await handler(entry("1-0", "{not json"));
  assert.equal(outcome, "ack");
});

test("unknown login is left pending", async () => {
  const db = fakeDb();
  const registry = registryWith(ACCOUNT);
  const status = new WorkerV2Status();
  const handler = makeHistoryHandler(db, registry, status);

  const outcome = await handler(
    entry("1-0", envelope("history.deal", 9999, { ticket: 1, time: 1735689600 })),
  );
  assert.equal(outcome, "leave-pending");
});

test("account missing brokerUtcOffsetMinutes is left pending", async () => {
  const db = fakeDb();
  const registry = registryWith({ ...ACCOUNT, brokerUtcOffsetMinutes: null });
  const status = new WorkerV2Status();
  const handler = makeHistoryHandler(db, registry, status);

  const outcome = await handler(
    entry("1-0", envelope("history.deal", 1001, { ticket: 1, time: 1735689600 })),
  );
  assert.equal(outcome, "leave-pending");
});

test("multiple accounts with overlapping ticket IDs stay isolated", async () => {
  const db = fakeDb();
  const accountA = { id: "accA", accountNo: "1001", brokerUtcOffsetMinutes: 180 };
  const accountB = { id: "accB", accountNo: "2002", brokerUtcOffsetMinutes: 180 };
  const registry = registryWith(accountA, accountB);
  const status = new WorkerV2Status();
  const handler = makeHistoryHandler(db, registry, status);

  await handler(
    entry("1-0", envelope("history.deal", 1001, { ticket: 777, time: 1735689600, profit: 1 })),
  );
  await handler(
    entry("2-0", envelope("history.deal", 2002, { ticket: 777, time: 1735689600, profit: 2 })),
  );

  assert.equal(db._deals.size, 2);
  assert.ok(db._deals.get("accA:777"));
  assert.ok(db._deals.get("accB:777"));
});

test("restart/pending reclaim: a stale pending entry is reclaimed and persisted, then acked", async () => {
  const db = fakeDb();
  const registry = registryWith(ACCOUNT);
  const status = new WorkerV2Status();
  const handler = makeHistoryHandler(db, registry, status);

  const staleEntry = entry(
    "5-0",
    envelope("history.deal", 1001, { ticket: 42, time: 1735689600 }),
  );
  const acked: string[] = [];
  const redis = {
    xPendingRange: async (_stream: string, _group: string, cursor: string) =>
      cursor === "-" ? [{ id: staleEntry.id, millisecondsSinceLastDelivery: 999_999 }] : [],
    xClaim: async () => [staleEntry],
    xAck: async (_stream: string, _group: string, id: string) => {
      acked.push(id);
    },
  };

  await reclaimPending(
    redis as any,
    historyStreamKey("1001"),
    "worker-v2-test",
    60_000,
    handler,
  );

  assert.deepEqual(acked, ["5-0"]);
  assert.ok(db._deals.get("acc1:42"));
});
