import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { createClient } from "redis";
import { processStreamEntry } from "./bridge-consumer";
import {
  buildRecordEnvelope,
  nextRecordsSha256,
  type HistoryBarrier,
} from "./bridge-protocol";
import {
  durableHistoryChunkId,
  EMPTY_RECORDS_SHA256,
  ensureHistoryCheckpoint,
  mirrorHistoryCheckpoint,
  persistHistoryBarrier,
  persistHistoryRecord,
} from "./history-checkpoint";

const enabled = process.env.RUN_HISTORY_RECOVERY_INTEGRATION === "1";
const integrationTest = enabled ? test : test.skip;
const START = "1735689600";
const END = "1738281600";

function requireDisposableEnvironment() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const redisUrl = process.env.REDIS_URL ?? "";
  if (!databaseUrl.includes("localhost:5434/history_verification")) {
    throw new Error(
      "integration test requires disposable PostgreSQL database localhost:5434/history_verification",
    );
  }
  if (!redisUrl.includes("localhost:6380")) {
    throw new Error(
      "integration test requires disposable Redis localhost:6380",
    );
  }
}

function barrier(
  accountNo: string,
  chunkId: string,
  stream: HistoryBarrier["stream"],
  overrides: Partial<HistoryBarrier> = {},
): HistoryBarrier {
  return {
    version: 1,
    type: "barrier",
    accountNo,
    stream,
    chunkId,
    parentChunkId: null,
    windowStartServerTime: START,
    windowEndServerTime: END,
    recordCount: 0,
    recordsSha256: EMPTY_RECORDS_SHA256,
    dealCursor: { time: START, ticket: "0" },
    orderCursor: { time: START, ticket: "0" },
    reachedPresent: false,
    reconstructionState: null,
    ...overrides,
  };
}

integrationTest(
  "PostgreSQL/Redis recovery barriers survive crash, replay, loss, and invalid input",
  async (t) => {
    requireDisposableEnvironment();
    const admin = new PrismaClient();
    const redis = createClient({ url: process.env.REDIS_URL });
    await admin.$connect();
    await redis.connect();
    const accountIds: string[] = [];

    async function fixture(label: string) {
      const accountNo = `verify-${label}-${randomUUID()}`;
      const account = await admin.tradingAccount.create({
        data: {
          accountNo,
          accountName: "History recovery verification",
          currency: "USD",
          serverName: "Disposable-Test",
          brokerUtcOffsetMinutes: 180,
        },
      });
      accountIds.push(account.id);
      await ensureHistoryCheckpoint(admin as never, account.id);
      return { account, accountNo };
    }

    try {
      await t.test(
        "worker crash after record commit resumes idempotently before barriers",
        async () => {
          const { account, accountNo } = await fixture("crash");
          const chunkId = randomUUID();
          const envelope = buildRecordEnvelope({
            accountNo,
            stream: "deals",
            chunkId,
            parentChunkId: null,
            windowStartServerTime: START,
            windowEndServerTime: END,
            dealCursor: { time: "1735689700", ticket: "1" },
            orderCursor: { time: START, ticket: "0" },
            ordinal: 0,
            expectedCount: 1,
            eventKey: "deal:1",
            payload: {
              ticket: 1,
              order: 2,
              positionId: null,
              symbol: "EURUSD",
              type: "buy",
              direction: "in",
              volume: 0.1,
              price: 1.1,
              commission: 0,
              fee: 0,
              swap: 0,
              profit: 1,
              balanceAfter: 1001,
              time: 1735689700,
              comment: "",
            },
          });
          const workerA = new PrismaClient();
          await persistHistoryRecord(
            workerA as never,
            account.id,
            accountNo,
            "deals",
            envelope,
            180,
          );
          await workerA.$disconnect();

          const before = await admin.bridgeHistoryCheckpoint.findUniqueOrThrow({
            where: { tradingAccountId: account.id },
          });
          assert.equal(String(before.completedThroughServerTime), START);
          const workerB = new PrismaClient();
          await persistHistoryRecord(
            workerB as never,
            account.id,
            accountNo,
            "deals",
            envelope,
            180,
          );
          const digest = nextRecordsSha256(
            EMPTY_RECORDS_SHA256,
            envelope.payloadSha256,
          );
          await persistHistoryBarrier(
            workerB as never,
            account.id,
            barrier(accountNo, chunkId, "deals", {
              recordCount: 1,
              recordsSha256: digest,
              dealCursor: envelope.dealCursor,
            }),
            180,
          );
          await persistHistoryBarrier(
            workerB as never,
            account.id,
            barrier(accountNo, chunkId, "orders", {
              dealCursor: envelope.dealCursor,
            }),
            180,
          );
          const committed = await persistHistoryBarrier(
            workerB as never,
            account.id,
            barrier(accountNo, chunkId, "position-closed", {
              dealCursor: envelope.dealCursor,
            }),
            180,
          );
          await workerB.$disconnect();

          assert.equal(committed?.lastCompletedChunkId, chunkId);
          const durableChunkId = durableHistoryChunkId(account.id, chunkId);
          assert.equal(
            await admin.bridgeHistoryRecord.count({
              where: { chunkId: durableChunkId },
            }),
            1,
          );
          assert.equal(
            (
              await admin.bridgeHistoryChunk.findUniqueOrThrow({
                where: { id: durableChunkId },
              })
            ).dealsAppliedCount,
            1,
          );
        },
      );

      await t.test(
        "database commit survives lost Redis acknowledgement and Redis flush",
        async () => {
          const { account, accountNo } = await fixture("ack-loss");
          const chunkId = randomUUID();
          const ackKey = `mt5:bridge:history-ack:${accountNo}`;
          const cursorKey = `mt5:bridge:history-cursor:${accountNo}`;
          await redis.del([ackKey, cursorKey]);
          await persistHistoryBarrier(
            admin as never,
            account.id,
            barrier(accountNo, chunkId, "deals"),
            180,
          );
          await persistHistoryBarrier(
            admin as never,
            account.id,
            barrier(accountNo, chunkId, "orders"),
            180,
          );
          await persistHistoryBarrier(
            admin as never,
            account.id,
            barrier(accountNo, chunkId, "position-closed"),
            180,
          );
          assert.equal(await redis.exists(ackKey), 0);

          const durable = await ensureHistoryCheckpoint(
            admin as never,
            account.id,
          );
          await mirrorHistoryCheckpoint(redis, accountNo, durable);
          assert.equal(
            JSON.parse((await redis.get(ackKey))!).lastCompletedChunkId,
            chunkId,
          );

          await redis.flushDb();
          assert.equal(await redis.exists(ackKey), 0);
          await mirrorHistoryCheckpoint(
            redis,
            accountNo,
            await ensureHistoryCheckpoint(admin as never, account.id),
          );
          assert.equal(
            JSON.parse((await redis.get(ackKey))!).lastCompletedChunkId,
            chunkId,
          );
          assert.equal(
            JSON.parse((await redis.get(cursorKey))!).deals.time,
            START,
          );
        },
      );

      await t.test(
        "empty Deal and Order windows create gap-free durable coverage",
        async () => {
          const { account, accountNo } = await fixture("empty");
          const chunkId = randomUUID();
          await persistHistoryBarrier(
            admin as never,
            account.id,
            barrier(accountNo, chunkId, "deals"),
            180,
          );
          await persistHistoryBarrier(
            admin as never,
            account.id,
            barrier(accountNo, chunkId, "orders"),
            180,
          );
          const committed = await persistHistoryBarrier(
            admin as never,
            account.id,
            barrier(accountNo, chunkId, "position-closed", {
              reconstructionState: {
                pending: { "101": [{ ticket: 1, time: 1735689700 }] },
                orders: {
                  "2": {
                    ticket: 2,
                    time_setup: 1735689650,
                    time_done: 1735689750,
                  },
                },
                volumes: { "101": 0.1 },
              },
            }),
            180,
          );
          assert.equal(committed?.completedThroughServerTime, END);
          const chunk = await admin.bridgeHistoryChunk.findUniqueOrThrow({
            where: { id: durableHistoryChunkId(account.id, chunkId) },
          });
          const reconstruction = chunk.reconstructionState as any;
          assert.equal(reconstruction.pending["101"][0].time, 1735689700);
          assert.equal(
            reconstruction.pending["101"][0].timeUtc,
            "2024-12-31T21:01:40.000Z",
          );
        },
      );

      await t.test(
        "same transport chunk ID advances two account checkpoints independently",
        async () => {
          const first = await fixture("shared-chunk-a");
          const second = await fixture("shared-chunk-b");
          const chunkId = randomUUID();

          for (const stream of [
            "deals",
            "orders",
            "position-closed",
          ] as const) {
            await persistHistoryBarrier(
              admin as never,
              first.account.id,
              barrier(first.accountNo, chunkId, stream),
              180,
            );
          }
          for (const stream of [
            "deals",
            "orders",
            "position-closed",
          ] as const) {
            await persistHistoryBarrier(
              admin as never,
              second.account.id,
              barrier(second.accountNo, chunkId, stream),
              180,
            );
          }

          const checkpoints = await admin.bridgeHistoryCheckpoint.findMany({
            where: {
              tradingAccountId: { in: [first.account.id, second.account.id] },
            },
            orderBy: { tradingAccountId: "asc" },
          });
          assert.equal(checkpoints.length, 2);
          assert.ok(
            checkpoints.every(
              (checkpoint) =>
                String(checkpoint.completedThroughServerTime) === END,
            ),
          );
          assert.equal(
            await admin.bridgeHistoryChunk.count({
              where: {
                id: {
                  in: [
                    durableHistoryChunkId(first.account.id, chunkId),
                    durableHistoryChunkId(second.account.id, chunkId),
                  ],
                },
              },
            }),
            2,
          );
        },
      );

      await t.test(
        "duplicate record and barrier replay stays idempotent",
        async () => {
          const { account, accountNo } = await fixture("replay");
          const chunkId = randomUUID();
          const envelope = buildRecordEnvelope({
            accountNo,
            stream: "deals",
            chunkId,
            parentChunkId: null,
            windowStartServerTime: START,
            windowEndServerTime: END,
            dealCursor: { time: "1735689700", ticket: "7" },
            orderCursor: { time: START, ticket: "0" },
            ordinal: 0,
            expectedCount: 1,
            eventKey: "deal:7",
            payload: {
              ticket: 7,
              order: 8,
              positionId: null,
              symbol: "EURUSD",
              type: "buy",
              direction: "in",
              volume: 0.1,
              price: 1.1,
              commission: 0,
              fee: 0,
              swap: 0,
              profit: 1,
              balanceAfter: 1001,
              time: 1735689700,
              comment: "",
            },
          });
          await persistHistoryRecord(
            admin as never,
            account.id,
            accountNo,
            "deals",
            envelope,
            180,
          );
          await persistHistoryRecord(
            admin as never,
            account.id,
            accountNo,
            "deals",
            envelope,
            180,
          );
          const common = { dealCursor: envelope.dealCursor };
          const dealBarrier = barrier(accountNo, chunkId, "deals", {
            ...common,
            recordCount: 1,
            recordsSha256: nextRecordsSha256(
              EMPTY_RECORDS_SHA256,
              envelope.payloadSha256,
            ),
          });
          const orderBarrier = barrier(accountNo, chunkId, "orders", common);
          const positionBarrier = barrier(
            accountNo,
            chunkId,
            "position-closed",
            common,
          );
          await persistHistoryBarrier(
            admin as never,
            account.id,
            dealBarrier,
            180,
          );
          await persistHistoryBarrier(
            admin as never,
            account.id,
            orderBarrier,
            180,
          );
          const first = await persistHistoryBarrier(
            admin as never,
            account.id,
            positionBarrier,
            180,
          );
          await persistHistoryBarrier(
            admin as never,
            account.id,
            dealBarrier,
            180,
          );
          await persistHistoryBarrier(
            admin as never,
            account.id,
            orderBarrier,
            180,
          );
          const replay = await persistHistoryBarrier(
            admin as never,
            account.id,
            positionBarrier,
            180,
          );
          assert.equal(
            await admin.bridgeHistoryRecord.count({
              where: { chunkId: durableHistoryChunkId(account.id, chunkId) },
            }),
            1,
          );
          assert.equal(
            replay?.lastCompletedChunkId,
            first?.lastCompletedChunkId,
          );
        },
      );

      await t.test(
        "digest/count mismatch and one-stream failure cannot advance checkpoint",
        async () => {
          const { account, accountNo } = await fixture("mismatch");
          const chunkId = randomUUID();
          await persistHistoryBarrier(
            admin as never,
            account.id,
            barrier(accountNo, chunkId, "deals"),
            180,
          );
          await assert.rejects(
            persistHistoryBarrier(
              admin as never,
              account.id,
              barrier(accountNo, chunkId, "orders", {
                recordsSha256: "0".repeat(64),
              }),
              180,
            ),
            /count\/digest mismatch/,
          );
          const checkpoint =
            await admin.bridgeHistoryCheckpoint.findUniqueOrThrow({
              where: { tradingAccountId: account.id },
            });
          const chunk = await admin.bridgeHistoryChunk.findUniqueOrThrow({
            where: { id: durableHistoryChunkId(account.id, chunkId) },
          });
          assert.equal(String(checkpoint.completedThroughServerTime), START);
          assert.notEqual(chunk.dealsBarrierAt, null);
          assert.equal(chunk.ordersBarrierAt, null);
        },
      );

      await t.test(
        "missing offset rejects barrier before checkpoint advancement",
        async () => {
          const { account, accountNo } = await fixture("offset");
          const chunkId = randomUUID();
          let callbacks = 0;
          await assert.rejects(
            processStreamEntry(
              admin as never,
              "deals",
              account.id,
              JSON.stringify(barrier(accountNo, chunkId, "deals")),
              undefined,
              "defer",
              accountNo,
              null,
              async () => {
                callbacks += 1;
              },
            ),
            /brokerUtcOffsetMinutes/,
          );
          assert.equal(callbacks, 0);
          assert.equal(
            await admin.bridgeHistoryChunk.count({
              where: { id: durableHistoryChunkId(account.id, chunkId) },
            }),
            0,
          );
          const checkpoint =
            await admin.bridgeHistoryCheckpoint.findUniqueOrThrow({
              where: { tradingAccountId: account.id },
            });
          assert.equal(String(checkpoint.completedThroughServerTime), START);
        },
      );

      await t.test(
        "completed backfill transitions to incremental exactly once",
        async () => {
          const { account, accountNo } = await fixture("complete");
          const chunkId = randomUUID();
          const tail = { reachedPresent: true };
          const deals = barrier(accountNo, chunkId, "deals", tail);
          const orders = barrier(accountNo, chunkId, "orders", tail);
          const positions = barrier(
            accountNo,
            chunkId,
            "position-closed",
            tail,
          );
          await persistHistoryBarrier(admin as never, account.id, deals, 180);
          await persistHistoryBarrier(admin as never, account.id, orders, 180);
          const first = await persistHistoryBarrier(
            admin as never,
            account.id,
            positions,
            180,
          );
          await persistHistoryBarrier(admin as never, account.id, deals, 180);
          await persistHistoryBarrier(admin as never, account.id, orders, 180);
          const replay = await persistHistoryBarrier(
            admin as never,
            account.id,
            positions,
            180,
          );
          assert.equal(first?.phase, "incremental");
          assert.equal(replay?.backfillCompletedAt, first?.backfillCompletedAt);
          assert.equal(replay?.lastCompletedChunkId, chunkId);
        },
      );

      await t.test(
        "checkpoint foreign keys target Account(id) and cascade",
        async () => {
          const constraints = await admin.$queryRaw<
            Array<{
              constraint_name: string;
              table_name: string;
              foreign_table_name: string;
              foreign_column_name: string;
              delete_rule: string;
            }>
          >`
        SELECT tc.constraint_name,
               tc.table_name,
               ccu.table_name AS foreign_table_name,
               ccu.column_name AS foreign_column_name,
               rc.delete_rule
          FROM information_schema.table_constraints tc
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_schema = tc.constraint_schema
           AND ccu.constraint_name = tc.constraint_name
          JOIN information_schema.referential_constraints rc
            ON rc.constraint_schema = tc.constraint_schema
           AND rc.constraint_name = tc.constraint_name
         WHERE tc.constraint_name IN (
           'BridgeHistoryCheckpoint_account_id_fkey',
           'BridgeHistoryChunk_account_id_fkey'
         )
         ORDER BY tc.constraint_name
      `;
          assert.equal(constraints.length, 2);
          for (const constraint of constraints) {
            assert.equal(constraint.foreign_table_name, "Account");
            assert.equal(constraint.foreign_column_name, "id");
            assert.equal(constraint.delete_rule, "CASCADE");
          }

          await assert.rejects(
            admin.bridgeHistoryCheckpoint.create({
              data: { tradingAccountId: `missing-${randomUUID()}` } as any,
            }),
          );

          const { account, accountNo } = await fixture("fk-cascade");
          const chunkId = randomUUID();
          await persistHistoryBarrier(
            admin as never,
            account.id,
            barrier(accountNo, chunkId, "deals"),
            180,
          );
          await admin.tradingAccount.delete({ where: { id: account.id } });
          assert.equal(
            await admin.bridgeHistoryCheckpoint.count({
              where: { tradingAccountId: account.id },
            }),
            0,
          );
          assert.equal(
            await admin.bridgeHistoryChunk.count({
              where: { id: durableHistoryChunkId(account.id, chunkId) },
            }),
            0,
          );
        },
      );
    } finally {
      if (accountIds.length)
        await admin.tradingAccount.deleteMany({
          where: { id: { in: accountIds } },
        });
      await redis.quit();
      await admin.$disconnect();
    }
  },
);
