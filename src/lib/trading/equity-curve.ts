import type { EquitySnapshot } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getMt5LiveData } from "@/lib/redis-mt5";
import { startOfBangkokDay, endOfBangkokDay } from "@/lib/time";
import type { BalanceEventPoint, ChartPoint } from "@/lib/trading/types";

// Timeout guard for the Redis live-data lookup used when merging the
// in-progress live equity point. Redis being unreachable should not stall
// the primary account balance route (see equity-curve.test.ts).
const LIVE_DATA_TIMEOUT_MS = 4_000;
const NO_LIVE_DATA = Symbol("equity-curve:no-live-data");

export function getTodayWindow(now: Date = new Date()) {
  const start = startOfBangkokDay(now) ?? now;
  const end = endOfBangkokDay(now) ?? now;
  return { start, end };
}

/**
 * Maps raw EquitySnapshot DB rows (genuine real-UTC instants) into chart
 * points. Deal/Position timestamps are also genuine real-UTC (converted
 * from broker server time via serverTimeToUtc at persistence time), so both
 * series share the same UTC time base with no further conversion needed.
 */
export function mapEquitySnapshotRowsToPoints(
  rows: Pick<EquitySnapshot, "ts" | "equity">[],
): BalanceEventPoint[] {
  return rows.map((row) => ({
    x: row.ts.toISOString(),
    y: Number(row.equity),
    balance: Number(row.equity),
    eventType: null,
    eventDelta: null,
  }));
}

/**
 * Merges a live point into an existing series. Both `points` and
 * `liveTimestamp` are genuine real-UTC instants — no conversion needed.
 */
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

type Mt5LiveDataResult = Awaited<ReturnType<typeof getMt5LiveData>>;

async function getLiveDataWithTimeout(
  accountNo: string,
): Promise<Mt5LiveDataResult | typeof NO_LIVE_DATA> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<typeof NO_LIVE_DATA>((resolve) => {
    timer = setTimeout(() => resolve(NO_LIVE_DATA), LIVE_DATA_TIMEOUT_MS);
  });

  // Ensure the live-data call can never produce an unhandled rejection when
  // it loses the race — swallow failures into the same sentinel used for
  // "no live data", identical to the existing Redis-failure fallback.
  const livePromise: Promise<Mt5LiveDataResult | typeof NO_LIVE_DATA> =
    getMt5LiveData(accountNo).then(
      (data) => data,
      () => NO_LIVE_DATA,
    );

  try {
    return await Promise.race([livePromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

function isLiveData(
  value: Mt5LiveDataResult | typeof NO_LIVE_DATA,
): value is Mt5LiveDataResult {
  return value !== NO_LIVE_DATA;
}

export async function buildEquityCurveForAccount(
  accountId: string,
  accountNo: string,
): Promise<BalanceEventPoint[]> {
  const now = new Date();
  const { start, end } = getTodayWindow(now);

  const rows = await prisma.equitySnapshot.findMany({
    where: { tradingAccountId: accountId, ts: { gte: start, lte: end } },
    orderBy: { ts: "asc" },
  });

  const points = mapEquitySnapshotRowsToPoints(rows);

  const live = await getLiveDataWithTimeout(accountNo);
  if (isLiveData(live) && live.live) {
    return mergeLiveEquityPoint(points, now, live.live.equity);
  }

  return points;
}

/**
 * Maps EquitySnapshot's own persisted `drawdown`/`peakEquity` columns
 * (computed once at ingestion time by the equity sampler) into a percent
 * series — no recomputation from raw equity here.
 */
export function mapEquitySnapshotRowsToDrawdownPercentPoints(
  rows: Pick<EquitySnapshot, "ts" | "peakEquity" | "drawdown">[],
): ChartPoint[] {
  return rows.map((row) => {
    const peak = row.peakEquity != null ? Number(row.peakEquity) : null;
    const drawdown = row.drawdown != null ? Number(row.drawdown) : 0;
    return {
      x: row.ts.toISOString(),
      y: peak && peak > 0 ? (drawdown / peak) * 100 : 0,
    };
  });
}

/**
 * True live-equity drawdown (as opposed to DrawdownEquityPanel's prior
 * balance/Deal-derived series).
 *
 * EquitySnapshot only retains RETENTION_DAYS (7) of history
 * (src/worker/equity-sampler.ts), so windows longer than that return
 * whatever's actually available, not a reconstructed longer history.
 */
export async function buildEquityDrawdownSeries(
  accountId: string,
  since: Date | null,
): Promise<{
  equityCurve: BalanceEventPoint[];
  drawdownPercentCurve: ChartPoint[];
}> {
  const rows = await prisma.equitySnapshot.findMany({
    where: {
      tradingAccountId: accountId,
      ...(since ? { ts: { gte: since } } : {}),
    },
    orderBy: { ts: "asc" },
  });

  return {
    equityCurve: mapEquitySnapshotRowsToPoints(rows),
    drawdownPercentCurve: mapEquitySnapshotRowsToDrawdownPercentPoints(rows),
  };
}
