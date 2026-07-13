import { prisma } from "../src/lib/prisma";
import { getRedisSocialClient } from "../src/lib/redis-social";

const prismaClient = prisma as any;

async function main() {
  const redis = await getRedisSocialClient();
  const accounts = await prismaClient.tradingAccount.findMany({
    select: { id: true, accountNo: true },
    orderBy: { accountNo: "asc" },
  });

  for (const account of accounts) {
    const [dealAgg, orderAgg, positionAgg, checkpoint, chunkCount, ackMirror] = await Promise.all([
      prismaClient.deal.aggregate({
        where: { tradingAccountId: account.id },
        _count: { _all: true },
        _min: { time: true },
        _max: { time: true },
      }),
      prismaClient.order.aggregate({
        where: { tradingAccountId: account.id },
        _count: { _all: true },
        _min: { timeSetup: true },
        _max: { timeSetup: true },
      }),
      prismaClient.position.aggregate({
        where: { tradingAccountId: account.id },
        _count: { _all: true },
        _min: { closeTime: true },
        _max: { closeTime: true },
      }),
      prismaClient.bridgeHistoryCheckpoint.findUnique({ where: { tradingAccountId: account.id } }),
      prismaClient.bridgeHistoryChunk.count({ where: { tradingAccountId: account.id, completedAt: { not: null } } }),
      redis.get(`mt5:bridge:history-ack:${account.accountNo}`),
    ]);

    console.log(`\naccount ${account.accountNo}`);
    console.log(`  Deal:     count=${dealAgg._count._all} min=${dealAgg._min.time?.toISOString() ?? "-"} max=${dealAgg._max.time?.toISOString() ?? "-"}`);
    console.log(`  Order:    count=${orderAgg._count._all} min=${orderAgg._min.timeSetup?.toISOString() ?? "-"} max=${orderAgg._max.timeSetup?.toISOString() ?? "-"}`);
    console.log(`  Position: count=${positionAgg._count._all} min=${positionAgg._min.closeTime?.toISOString() ?? "-"} max=${positionAgg._max.closeTime?.toISOString() ?? "-"}`);
    console.log(`  Checkpoint: phase=${checkpoint?.phase ?? "missing"} completedThrough=${checkpoint?.completedThroughServerTime?.toString() ?? "-"} lastChunk=${checkpoint?.lastCompletedChunkId ?? "-"}`);
    console.log(`  Completed chunks: ${chunkCount}; Redis mirror: ${ackMirror ? "present" : "missing"}`);
  }
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
