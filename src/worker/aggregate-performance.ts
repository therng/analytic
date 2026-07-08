import { prisma } from "@/lib/prisma";
import { getRedisSocialClient } from "@/lib/redis-social";

export async function runAggregation() {
  console.log("Running performance aggregation job...");
  const redis = await getRedisSocialClient();
  const accounts = await prisma.tradingAccount.findMany({ select: { accountNo: true, id: true } });

  for (const account of accounts) {
    const lastSyncKey = `mt5:agg:last_synced:${account.id}`;
    const lastRunKey = `mt5:agg:last_run:${account.id}`;

    const lastRunStr = await redis.get(lastRunKey);
    const lastRun = lastRunStr ? parseInt(lastRunStr) : 0;
    if (Date.now() - lastRun < 5 * 60 * 1000) {
      continue;
    }

    const lastSyncStr = await redis.get(lastSyncKey);
    const lastSync = lastSyncStr ? new Date(lastSyncStr) : new Date(0);

    const newPositionsCount = await prisma.closedPosition.count({
      where: {
        account_number: account.accountNo,
        updated_at: { gt: lastSync }
      }
    });

    if (newPositionsCount === 0) {
      continue;
    }

    console.log(`Processing ${newPositionsCount} new positions for account ${account.accountNo}...`);

    // Fetch ALL closed positions for the account (full recompute)
    const positions = await prisma.closedPosition.findMany({
      where: { account_number: account.accountNo },
      select: {
        symbol: true,
        profit: true,
        swap: true,
        commission: true,
        volume: true,
        magic: true,
      },
    });

    // Aggregation logic... (rest of the aggregation remains same)
    const symbolGroups = new Map<string, any>();
    const strategyGroups = new Map<number, any>();

    for (const pos of positions) {
      const net = Number(pos.profit ?? 0) + Number(pos.swap ?? 0) + Number(pos.commission ?? 0);
      
      const sym = pos.symbol.trim().toUpperCase();
      if (!symbolGroups.has(sym)) {
        symbolGroups.set(sym, { netProfit: 0, trades: 0, wins: 0, totalVolume: 0 });
      }
      const gSym = symbolGroups.get(sym);
      gSym.netProfit += net;
      gSym.trades += 1;
      gSym.totalVolume += Number(pos.volume ?? 0);
      if (net > 0) gSym.wins += 1;

      const magic = pos.magic ?? 0;
      if (!strategyGroups.has(magic)) {
        strategyGroups.set(magic, { netProfit: 0, trades: 0, wins: 0, totalVolume: 0 });
      }
      const gStrat = strategyGroups.get(magic);
      gStrat.netProfit += net;
      gStrat.trades += 1;
      gStrat.totalVolume += Number(pos.volume ?? 0);
      if (net > 0) gStrat.wins += 1;
    }

    await prisma.$transaction([
      ...Array.from(symbolGroups.entries()).map(([sym, g]) => 
        prisma.accountPerformanceBySymbol.upsert({
          where: { accountId_symbol: { accountId: account.id, symbol: sym } },
          update: { netProfit: g.netProfit, trades: g.trades, wins: g.wins, totalVolume: g.totalVolume },
          create: { accountId: account.id, symbol: sym, netProfit: g.netProfit, trades: g.trades, wins: g.wins, totalVolume: g.totalVolume },
        })
      ),
      ...Array.from(strategyGroups.entries()).map(([magic, g]) => 
        prisma.accountPerformanceByStrategy.upsert({
          where: { accountId_magic: { accountId: account.id, magic: magic } },
          update: { netProfit: g.netProfit, trades: g.trades, wins: g.wins, totalVolume: g.totalVolume },
          create: { accountId: account.id, magic: magic, netProfit: g.netProfit, trades: g.trades, wins: g.wins, totalVolume: g.totalVolume },
        })
      )
    ]);
    
    await redis.set(lastRunKey, Date.now().toString());
    await redis.set(lastSyncKey, new Date().toISOString());
  }
  console.log("Performance aggregation job completed.");
}
