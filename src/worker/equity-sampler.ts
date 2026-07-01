import { prisma } from "../lib/prisma";
import { getMt5LiveData, type Mt5LiveInfo, type Mt5Position } from "../lib/redis-mt5";

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

export async function sampleEquityOnce() {
  const accounts = await prisma.tradingAccount.findMany({
    select: { id: true, accountNo: true },
  });

  const ts = truncateToMinute(new Date());

  for (const account of accounts) {
    try {
      const data = await getMt5LiveData(account.accountNo);
      if (!data.live) continue;

      const snapshotRow = buildEquitySnapshotRow(account.id, ts, data.live);
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
