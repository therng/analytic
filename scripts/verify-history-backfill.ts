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
    const [dealAgg, orderAgg, positionAgg, backfillState] = await Promise.all([
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
      redis.hGetAll(`mt5:bridge:backfill-state:${account.accountNo}`),
    ]);

    console.log(`\naccount ${account.accountNo}`);
    console.log(`  Deal:     count=${dealAgg._count._all} min=${dealAgg._min.time?.toISOString() ?? "-"} max=${dealAgg._max.time?.toISOString() ?? "-"}`);
    console.log(`  Order:    count=${orderAgg._count._all} min=${orderAgg._min.timeSetup?.toISOString() ?? "-"} max=${orderAgg._max.timeSetup?.toISOString() ?? "-"}`);
    console.log(`  Position: count=${positionAgg._count._all} min=${positionAgg._min.closeTime?.toISOString() ?? "-"} max=${positionAgg._max.closeTime?.toISOString() ?? "-"}`);
    if (Object.keys(backfillState).length) {
      const emittedDeals = Number(backfillState.emittedDeals ?? 0);
      const emittedOrders = Number(backfillState.emittedOrders ?? 0);
      console.log(
        `  Redis backfill-state: status=${backfillState.status ?? "-"} emittedDeals=${emittedDeals} emittedOrders=${emittedOrders} ` +
        `(Postgres Deal count ${dealAgg._count._all >= emittedDeals ? "matches or exceeds" : "LAGS BEHIND"} emitted, ` +
        `Order count ${orderAgg._count._all >= emittedOrders ? "matches or exceeds" : "LAGS BEHIND"} emitted — worker drain may still be catching up)`,
      );
    } else {
      console.log("  Redis backfill-state: (none — backfill not run for this login)");
    }
  }
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
