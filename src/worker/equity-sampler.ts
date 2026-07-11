import { prisma } from "../lib/prisma";
import { getMt5LiveData, type Mt5LiveInfo, type Mt5Position } from "../lib/redis-mt5";
import { ensureBridgeAccounts } from "./bridge-accounts";

const SAMPLE_INTERVAL_MS = 60_000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_DAYS = 7;

export function truncateToMinute(date: Date): Date {
  const truncated = new Date(date);
  truncated.setSeconds(0, 0);
  return truncated;
}

export function buildEquitySnapshotRow(tradingAccountId: string, ts: Date, live: Mt5LiveInfo) {
  return {
    tradingAccountId,
    ts,
    equity: live.equity,
    margin: live.margin,
    balance: live.balance,
  };
}

export function buildPositionExcursionRows(tradingAccountId: string, ts: Date, positions: Mt5Position[]) {
  return positions.map((position) => ({
    tradingAccountId,
    positionTicket: String(position.ticket),
    ts,
    profit: position.profit,
  }));
}

export function buildAccountSnapshotRow(tradingAccountId: string, ts: Date, live: Mt5LiveInfo) {
  return {
    tradingAccountId,
    sourceFileName: "bridge-live",
    balance: live.balance,
    creditFacility: live.credit,
    floatingPl: live.profit,
    equity: live.equity,
    freeMargin: live.freeMargin,
    margin: live.margin,
    marginLevel: live.marginLevel,
    reportDate: ts,
  };
}

function mt5TypeToString(type: number): string {
  return type === 1 ? "sell" : "buy";
}

export function buildOpenPositionRows(tradingAccountId: string, ts: Date, positions: Mt5Position[]) {
  return positions.map((position) => ({
    tradingAccountId,
    positionNo: String(position.ticket),
    openTime: new Date(position.openTime * 1000),
    symbol: position.symbol,
    type: mt5TypeToString(position.type),
    volume: position.volume,
    price: position.openPrice,
    sl: position.sl || null,
    tp: position.tp || null,
    marketPrice: position.currentPrice,
    swap: position.swap,
    profit: position.profit,
    comment: position.comment,
    magic: position.magic ?? null,
    reportDate: ts,
  }));
}

async function getEquityState(accountNo: string): Promise<{ peakEquity: number } | null> {
  const redis = await (await import("../lib/redis-social")).getRedisSocialClient();
  const raw = await redis.hGetAll(`mt5:account:${accountNo}:equity-state`);
  if (!raw.peakEquity) return null;
  return { peakEquity: Number.parseFloat(raw.peakEquity) };
}

export async function sampleEquityOnce() {
  await ensureBridgeAccounts();

  const accounts = await prisma.tradingAccount.findMany({
    select: { id: true, accountNo: true },
  });

  const ts = truncateToMinute(new Date());

  for (const account of accounts) {
    try {
      const data = await getMt5LiveData(account.accountNo);
      if (!data.live) continue;
      // The `:live` hash has no TTL, so stale bridge data lingers after a
      // disconnect. Only trust it for current-state writes (AccountSnapshot,
      // OpenPosition) when the `:positions` key (10s TTL) is still fresh;
      // otherwise skip those writes so we don't overwrite good data with a
      // stale snapshot or wipe out open positions that simply expired
      // alongside the bridge connection.
      const isFresh = !data.stale;

      const equityStateRaw = await getEquityState(account.accountNo);
      const snapshotRow = {
        ...buildEquitySnapshotRow(account.id, ts, data.live),
        floatingPl: data.live.profit,
        peakEquity: equityStateRaw?.peakEquity ?? null,
        drawdown: equityStateRaw ? Math.max(0, equityStateRaw.peakEquity - data.live.equity) : null,
      };
      await prisma.equitySnapshot.upsert({
        where: { tradingAccountId_ts: { tradingAccountId: account.id, ts } },
        create: snapshotRow,
        update: snapshotRow,
      });

      for (const row of buildPositionExcursionRows(account.id, ts, data.positions)) {
        await prisma.positionExcursion.upsert({
          where: {
            tradingAccountId_positionTicket_ts: {
              tradingAccountId: row.tradingAccountId,
              positionTicket: row.positionTicket,
              ts: row.ts,
            },
          },
          create: row,
          update: row,
        });
      }

      if (isFresh) {
        const accountSnapshotRow = buildAccountSnapshotRow(account.id, ts, data.live);
        await prisma.accountSnapshot.upsert({
          where: { tradingAccountId: account.id },
          create: accountSnapshotRow,
          update: accountSnapshotRow,
        });

        await prisma.$transaction([
          prisma.openPosition.deleteMany({ where: { tradingAccountId: account.id } }),
          ...(data.positions.length
            ? [prisma.openPosition.createMany({ data: buildOpenPositionRows(account.id, ts, data.positions) })]
            : []),
        ]);
      }
    } catch (error) {
      console.error(`[equity-sampler] Failed to sample account ${account.accountNo}:`, error);
    }
  }
}

export async function pruneOldSnapshots(retentionDays = RETENTION_DAYS) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  await prisma.equitySnapshot.deleteMany({ where: { ts: { lt: cutoff } } });
  await prisma.positionExcursion.deleteMany({ where: { ts: { lt: cutoff } } });
}

export function startEquitySampler() {
  let stopped = false;
  let sampleTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleNext = () => {
    if (stopped) return;
    sampleTimer = setTimeout(runSamplePass, SAMPLE_INTERVAL_MS);
  };

  // Self-scheduling loop: the next pass is only scheduled once the current
  // one has finished (success or failure), so slow passes never overlap
  // (unlike a bare setInterval, which would fire the next tick regardless).
  function runSamplePass() {
    sampleEquityOnce()
      .catch((error) => console.error("[equity-sampler] sample pass failed:", error))
      .finally(scheduleNext);
  }

  scheduleNext();

  const pruneInterval = setInterval(() => {
    pruneOldSnapshots().catch((error) => console.error("[equity-sampler] prune pass failed:", error));
  }, PRUNE_INTERVAL_MS);

  return () => {
    stopped = true;
    clearTimeout(sampleTimer);
    clearInterval(pruneInterval);
  };
}
