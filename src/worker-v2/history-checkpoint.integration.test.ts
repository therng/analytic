// Integration test: Package 3b (durable checkpoint + Positions barrier
// reconciliation) and Package 4 (ack mirror) against REAL PostgreSQL and
// Redis — not the in-memory fakeDb/fakeRedis used everywhere else. Every
// other test in this module proves the logic in isolation; this proves the
// same code actually behaves correctly against real Prisma transactions,
// real BigInt/Json columns, and a real Redis client — including the
// `prisma as unknown as DbLike` boundary cast used in production wiring.
//
// Requires the isolated test stack: `npm run test:env:up` (db-test:5434,
// redis-test:6380), migrations applied (`npx prisma migrate deploy` against
// that DATABASE_URL). Opt-in, mirrors the existing convention in
// the retired worker recovery integration suite.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { createClient } from "redis";
import {
  ensureHistoryCheckpoint,
  persistHistoryRecord,
  persistHistoryBarrier,
  mirrorHistoryCheckpoint,
  historyAckKey,
  nextRecordsSha256,
  EMPTY_RECORDS_SHA256,
  type DbLike,
  type HistoryRecordEnvelope,
  type HistoryBarrierEnvelope,
} from "./history-checkpoint";
import { makeReconstructPosition } from "./reconstruct-position-adapter";
import { mapDealToPrisma, mapOrderToPrisma } from "./mappers";

const enabled = process.env.RUN_WORKER_V2_HISTORY_INTEGRATION === "1";
const integrationTest = enabled ? test : test.skip;

function requireDisposableEnvironment() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const redisUrl = process.env.REDIS_URL ?? "";
  if (!databaseUrl.includes("localhost:5434")) {
    throw new Error("integration test requires the disposable PostgreSQL stack on localhost:5434 (npm run test:env:up)");
  }
  if (!redisUrl.includes("localhost:6380")) {
    throw new Error("integration test requires the disposable Redis stack on localhost:6380 (npm run test:env:up)");
  }
}

const OFFSET_MINUTES = 180;
const WINDOW_START = "1735689600";
const WINDOW_END = "1738281600";
const DEAL_OPEN_TIME = Number(WINDOW_START) + 100;
const DEAL_CLOSE_TIME = Number(WINDOW_START) + 200;

function dealPayloadSha(record: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

integrationTest(
  "Package 3b/4: real Postgres + real Redis — full record->barrier->checkpoint->mirror flow",
  async (t) => {
    requireDisposableEnvironment();
    const admin = new PrismaClient();
    const redis = createClient({ url: process.env.REDIS_URL });
    await admin.$connect();
    await redis.connect();
    const accountIds: string[] = [];

    async function fixture(label: string) {
      const accountNo = `wv2-verify-${label}-${randomUUID()}`;
      const account = await admin.tradingAccount.create({
        data: {
          accountNo,
          accountName: "Worker V2 integration verification",
          currency: "USD",
          serverName: "Disposable-Test",
          brokerUtcOffsetMinutes: OFFSET_MINUTES,
        },
      });
      accountIds.push(account.id);
      return { account, accountNo };
    }

    try {
      await t.test(
        "two deals close a real Position via reconstructPositionIfClosed, checkpoint advances, ack mirrors to real Redis",
        async () => {
          const { account, accountNo } = await fixture("close");
          const positionId = "500001";
          const dealOpen = { ticket: 1, order: 10, position_id: positionId, symbol: "EURUSD", type: 0, entry: 0, volume: 0.1, price: 1.1, commission: 0, fee: 0, swap: 0, profit: 0, time: DEAL_OPEN_TIME, comment: "" };
          const dealClose = { ticket: 2, order: 11, position_id: positionId, symbol: "EURUSD", type: 1, entry: 1, volume: 0.1, price: 1.105, commission: 0, fee: 0, swap: 0, profit: 5, time: DEAL_CLOSE_TIME, comment: "" };
          const order = { ticket: 9001, position_id: positionId, symbol: "EURUSD", type: 0, volume_initial: 0.1, price_open: 1.1, time_setup: DEAL_OPEN_TIME, time_done: DEAL_OPEN_TIME, comment: "" };

          const dealOpenSha = dealPayloadSha(dealOpen);
          const dealCloseSha = dealPayloadSha(dealClose);
          const orderSha = dealPayloadSha(order);
          const dealsDigest = nextRecordsSha256(nextRecordsSha256(EMPTY_RECORDS_SHA256, dealOpenSha), dealCloseSha);
          const ordersDigest = nextRecordsSha256(EMPTY_RECORDS_SHA256, orderSha);

          function dealEnvelope(record: typeof dealOpen, ordinal: number, sha: string): HistoryRecordEnvelope {
            return {
              chunkId: "chunk-1",
              parentChunkId: null,
              windowStartServerTime: WINDOW_START,
              windowEndServerTime: WINDOW_END,
              reachedPresent: true,
              dealCursor: { time: WINDOW_END, ticket: "0" },
              orderCursor: { time: WINDOW_END, ticket: "0" },
              ordinal,
              expectedCount: 2,
              eventKey: String(record.ticket),
              payloadSha256: sha,
            };
          }

          const client = admin as unknown as DbLike;

          await persistHistoryRecord(client, account.id, "deals", dealEnvelope(dealOpen, 0, dealOpenSha), async (tx) => {
            await tx.deal.upsert({
              where: { tradingAccountId_dealNo: { tradingAccountId: account.id, dealNo: "1" } },
              create: mapDealToPrisma(account.id, dealOpen, OFFSET_MINUTES),
              update: mapDealToPrisma(account.id, dealOpen, OFFSET_MINUTES),
            });
          });
          await persistHistoryRecord(client, account.id, "deals", dealEnvelope(dealClose, 1, dealCloseSha), async (tx) => {
            await tx.deal.upsert({
              where: { tradingAccountId_dealNo: { tradingAccountId: account.id, dealNo: "2" } },
              create: mapDealToPrisma(account.id, dealClose, OFFSET_MINUTES),
              update: mapDealToPrisma(account.id, dealClose, OFFSET_MINUTES),
            });
          });
          await persistHistoryRecord(
            client,
            account.id,
            "orders",
            {
              chunkId: "chunk-1",
              parentChunkId: null,
              windowStartServerTime: WINDOW_START,
              windowEndServerTime: WINDOW_END,
              reachedPresent: true,
              dealCursor: { time: WINDOW_END, ticket: "0" },
              orderCursor: { time: WINDOW_END, ticket: "0" },
              ordinal: 0,
              expectedCount: 1,
              eventKey: String(order.ticket),
              payloadSha256: orderSha,
            },
            async (tx) => {
              await tx.order.upsert({
                where: { tradingAccountId_orderTicket: { tradingAccountId: account.id, orderTicket: "9001" } },
                create: mapOrderToPrisma(account.id, order, OFFSET_MINUTES),
                update: mapOrderToPrisma(account.id, order, OFFSET_MINUTES),
              });
            },
          );

          const dealsBarrier: HistoryBarrierEnvelope = {
            stream: "deals",
            chunkId: "chunk-1",
            parentChunkId: null,
            windowStartServerTime: WINDOW_START,
            windowEndServerTime: WINDOW_END,
            reachedPresent: true,
            dealCursor: { time: WINDOW_END, ticket: "0" },
            orderCursor: { time: WINDOW_END, ticket: "0" },
            recordCount: 2,
            recordsSha256: dealsDigest,
          };
          const ordersBarrier: HistoryBarrierEnvelope = {
            ...dealsBarrier,
            stream: "orders",
            recordCount: 1,
            recordsSha256: ordersDigest,
          };

          const reconstructPosition = makeReconstructPosition(account.id, accountNo);
          const afterDeals = await persistHistoryBarrier(client, account.id, dealsBarrier, reconstructPosition, redis as never, accountNo);
          assert.equal(afterDeals, null, "orders barrier hasn't landed yet");

          const afterOrders = await persistHistoryBarrier(client, account.id, ordersBarrier, reconstructPosition, redis as never, accountNo);
          assert.ok(afterOrders, "checkpoint must advance once deals+orders+positions all complete against real Postgres");
          assert.equal(afterOrders!.phase, "incremental");

          const position = await admin.position.findUnique({
            where: { tradingAccountId_positionNo: { tradingAccountId: account.id, positionNo: positionId } },
          });
          assert.ok(position, "real reconstructPositionIfClosed must have written a closed Position row");
          assert.equal(position!.symbol, "EURUSD");
          assert.equal(Number(position!.volume), 0.1);

          await mirrorHistoryCheckpoint(redis as never, accountNo, afterOrders!);
          const rawAck = await redis.get(historyAckKey(accountNo));
          assert.ok(rawAck, "mirror must be written to real Redis");
          const ack = JSON.parse(rawAck!);
          // These are exactly the two fields bridge_v2's _resolve_durable_window
          // reads (history_publisher.py) — field-name parity between the TS
          // writer and the Python reader, proven against a real Redis value.
          assert.equal(ack.completedThroughServerTime, WINDOW_END);
          assert.equal(ack.lastCompletedChunkId, "chunk-1");
        },
      );

      await t.test("ensureHistoryCheckpoint clears a stale ack against real Redis on fresh-checkpoint creation", async () => {
        const { account, accountNo } = await fixture("stale-ack");
        await redis.set(historyAckKey(accountNo), JSON.stringify({ stale: true }));
        await ensureHistoryCheckpoint(admin as unknown as DbLike, account.id, redis as never, accountNo);
        assert.equal(await redis.exists(historyAckKey(accountNo)), 0, "stale ack must be cleared against a real Redis server");
      });
    } finally {
      if (accountIds.length) {
        await admin.tradingAccount.deleteMany({ where: { id: { in: accountIds } } });
      }
      await redis.quit();
      await admin.$disconnect();
    }
  },
);
