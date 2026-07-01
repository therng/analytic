import { prisma } from "@/lib/prisma";
import { getMt5LiveData } from "@/lib/redis-mt5";
import { startOfBangkokDay, endOfBangkokDay } from "@/lib/time";
import type { BalanceEventPoint } from "@/lib/trading/types";

export function getTodayWindow(now: Date = new Date()) {
  const start = startOfBangkokDay(now) ?? now;
  const end = endOfBangkokDay(now) ?? now;
  return { start, end };
}

export function mergeLiveEquityPoint(
  points: BalanceEventPoint[],
  liveTimestamp: Date | null,
  liveEquity: number | null,
): BalanceEventPoint[] {
  if (!liveTimestamp || !Number.isFinite(liveEquity)) {
    return points;
  }

  const livePoint: BalanceEventPoint = {
    x: liveTimestamp.toISOString(),
    y: Number(liveEquity),
    balance: Number(liveEquity),
    eventType: null,
    eventDelta: null,
  };

  if (!points.length) {
    return [livePoint];
  }

  const lastPoint = points[points.length - 1]!;
  const lastTime = new Date(lastPoint.x).getTime();
  const liveTime = liveTimestamp.getTime();

  if (!Number.isFinite(lastTime)) {
    return [...points, livePoint];
  }

  if (Math.abs(liveTime - lastTime) <= 60_000) {
    return [...points.slice(0, -1), { ...lastPoint, ...livePoint }];
  }

  if (liveTime > lastTime) {
    return [...points, livePoint];
  }

  return points;
}

export async function buildEquityCurveForAccount(
  accountId: string,
  accountNo: string,
): Promise<BalanceEventPoint[]> {
  const now = new Date();
  const { start, end } = getTodayWindow(now);

  const rows = await (prisma as any).equitySnapshot.findMany({
    where: { tradingAccountId: accountId, ts: { gte: start, lte: end } },
    orderBy: { ts: "asc" },
  });

  const points: BalanceEventPoint[] = rows.map((row: any) => ({
    x: row.ts.toISOString(),
    y: Number(row.equity),
    balance: Number(row.equity),
    eventType: null,
    eventDelta: null,
  }));

  try {
    const live = await getMt5LiveData(accountNo);
    if (live.live) {
      return mergeLiveEquityPoint(points, now, live.live.equity);
    }
  } catch {
    // Redis unavailable — fall back to DB-only points, same as the
    // existing /live route's failure behavior.
  }

  return points;
}
