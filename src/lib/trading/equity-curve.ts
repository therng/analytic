import type { EquitySnapshot } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getMt5LiveData } from "@/lib/redis-mt5";
import { startOfBangkokDay, endOfBangkokDay } from "@/lib/time";
import type { BalanceEventPoint, ChartPoint } from "@/lib/trading/types";
import {
  CURVE_POINT_BUDGET,
  downsampleBy,
} from "@/lib/trading/core/downsample";

// Timeout guard for the Redis live-data lookup used when merging the
// in-progress live equity point. Redis being unreachable should not stall
// the primary account balance route (see equity-curve.test.ts).
const LIVE_DATA_TIMEOUT_MS = 4_000;
const NO_LIVE_DATA = Symbol("equity-curve:no-live-data");

// Short-TTL, in-flight-deduped memo for snapshot-derived series. A timeframe
// switch fans out every mounted card's overview+balance pair at once, and the
// equity sampler only writes a row every ~60s — so serving a series that is
// at most 10s stale collapses the burst to ONE EquitySnapshot query while
// staying visually indistinguishable (the live dot rides the 2s live poll,
// not these curves). Insert-order LRU bounded well above 5 accounts x 7
// windows.
const EQUITY_SERIES_TTL_MS = 10_000;
const EQUITY_SERIES_MAX_ENTRIES = 200;
const equitySeriesMemo = new Map<
  string,
  { at: number; promise: Promise<unknown> }
>();

function memoizedEquitySeries<T>(
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const hit = equitySeriesMemo.get(key);
  if (hit && Date.now() - hit.at < EQUITY_SERIES_TTL_MS) {
    return hit.promise as Promise<T>;
  }
  const promise = load().catch((error: unknown) => {
    // Never memoize a failure — the next request retries the query.
    equitySeriesMemo.delete(key);
    throw error;
  });
  equitySeriesMemo.delete(key);
  equitySeriesMemo.set(key, { at: Date.now(), promise });
  while (equitySeriesMemo.size > EQUITY_SERIES_MAX_ENTRIES) {
    const oldest = equitySeriesMemo.keys().next().value;
    if (oldest === undefined) break;
    equitySeriesMemo.delete(oldest);
  }
  return promise;
}

export function getTodayWindow(now: Date = new Date()) {
  const start = startOfBangkokDay(now) ?? now;
  const end = endOfBangkokDay(now) ?? now;
  return { start, end };
}

/**
 * Maps raw EquitySnapshot DB rows (genuine real-UTC instants) into chart
 * points. MetaTrader Python Deal/Position timestamps are Unix UTC epochs, so
 * both series share the same UTC time base with no conversion needed.
 */
export function mapEquitySnapshotRowsToPoints(
  rows: Pick<EquitySnapshot, "ts" | "equity" | "balance" | "floatingPl">[],
): BalanceEventPoint[] {
  return rows.map((row) => {
    // No open exposure at sample time (floatingPl exactly 0) means equity
    // and balance are the same value by MT5 definition — use the stored
    // balance directly instead of trusting the broker's equity figure,
    // which can drift a few cents from balance on feed lag/rounding.
    const noOpenExposure =
      row.floatingPl != null && Number(row.floatingPl) === 0;
    const value = noOpenExposure ? Number(row.balance) : Number(row.equity);

    return {
      x: row.ts.toISOString(),
      y: value,
      balance: value,
      eventType: null,
      eventDelta: null,
    };
  });
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
  fallbackBalance?: number | null,
): Promise<BalanceEventPoint[]> {
  const now = new Date();

  // Snapshot-derived base series is memoized; the live point merge below
  // stays per-request so the freshest polled equity always tops the curve.
  const points = await memoizedEquitySeries(
    `equity-curve:${accountId}`,
    async () => {
      const { start, end } = getTodayWindow(now);

      const [rows, priorRows] = await Promise.all([
        prisma.equitySnapshot.findMany({
          where: { tradingAccountId: accountId, ts: { gte: start, lte: end } },
          orderBy: { ts: "asc" },
          select: {
            ts: true,
            equity: true,
            balance: true,
            floatingPl: true,
          },
        }),
        prisma.equitySnapshot.findMany({
          where: { tradingAccountId: accountId, ts: { lt: start } },
          orderBy: { ts: "desc" },
          take: 1,
          select: { ts: true, equity: true, balance: true, floatingPl: true },
        }),
      ]);

      // Anchor the line at the day boundary using the last equity value from
      // before day change, so it starts flush instead of jumping at today's
      // first sample — same anchoring buildRealtime24HourBalanceCurve does
      // for the balance line. No prior EquitySnapshot at all (fresh sampler,
      // account just onboarded) falls back to the day's balance value instead
      // of leaving the equity line to start floating mid-chart.
      const priorPoint = priorRows[0]
        ? mapEquitySnapshotRowsToPoints([{ ...priorRows[0], ts: start }])
        : Number.isFinite(fallbackBalance)
          ? [
              {
                x: start.toISOString(),
                y: fallbackBalance as number,
                balance: fallbackBalance as number,
                eventType: null,
                eventDelta: null,
              } satisfies BalanceEventPoint,
            ]
          : [];

      // A full trading day at the 60s sample cadence is ~1440 points; cap
      // the shipped curve to the sparkline budget (LTTB keeps the day anchor
      // first and the freshest sample last) before the live point merges on.
      return downsampleBy(
        [...priorPoint, ...mapEquitySnapshotRowsToPoints(rows)],
        CURVE_POINT_BUDGET,
        (point) => Date.parse(point.x),
        (point) => point.y,
      );
    },
  );

  const live = await getLiveDataWithTimeout(accountNo);
  if (isLiveData(live) && live.live) {
    // Same no-open-exposure rule as mapEquitySnapshotRowsToPoints — force
    // equity to balance when there's no floating P/L to bridge them.
    const liveEquity =
      live.live.profit === 0 ? live.live.balance : live.live.equity;
    return mergeLiveEquityPoint(points, now, liveEquity);
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
 * Maps EquitySnapshot's persisted `depositLoad` column (broker margin used /
 * equity, computed once at ingestion time by the equity sampler) into a percent
 * series — no recomputation from raw margin here.
 *
 * INTERIM historical path: the product deposit-load metric is now
 * XAUUSD-volume-derived (live value in `account.deposit_load_pct`), but no
 * persisted source supports recomputing it at past timestamps — see the note on
 * `maxPersistedDepositLoad` in `preaggregated/algo-summary.ts`. This curve stays
 * broker-margin-derived until a volume-based backfill exists.
 */
export function mapEquitySnapshotRowsToDepositLoadPercentPoints(
  rows: Pick<EquitySnapshot, "ts" | "depositLoad">[],
): ChartPoint[] {
  return rows.map((row) => ({
    x: row.ts.toISOString(),
    y: row.depositLoad != null ? Number(row.depositLoad) : 0,
  }));
}

/**
 * True live-equity drawdown (as opposed to DrawdownPanel's prior
 * balance/Deal-derived series).
 *
 * EquitySnapshot only retains RETENTION_DAYS (7) of history
 * (src/worker-v2/equity-sampler.ts), so windows longer than that return
 * whatever's actually available, not a reconstructed longer history.
 */
export async function buildEquityDrawdownSeries(
  accountId: string,
  since: Date | null,
): Promise<{
  equityCurve: BalanceEventPoint[];
  drawdownPercentCurve: ChartPoint[];
  depositLoadPercentCurve: ChartPoint[];
}> {
  return memoizedEquitySeries(
    `equity-drawdown:${accountId}:${since?.toISOString() ?? "all"}`,
    async () => {
      const rows = await prisma.equitySnapshot.findMany({
        where: {
          tradingAccountId: accountId,
          ...(since ? { ts: { gte: since } } : {}),
        },
        orderBy: { ts: "asc" },
        // Only the columns the three curve mappers read — the 7-day retained
        // window is ~10k rows, so full entity materialization is pure
        // overhead.
        select: {
          ts: true,
          equity: true,
          balance: true,
          floatingPl: true,
          peakEquity: true,
          drawdown: true,
          depositLoad: true,
        },
      });

      // Sample the ROWS once (keyed on equity) so all three derived curves
      // stay point-aligned at the same timestamps instead of drifting
      // independently.
      const sampledRows = downsampleBy(
        rows,
        CURVE_POINT_BUDGET,
        (row) => row.ts.getTime(),
        (row) => Number(row.equity),
      );

      return {
        equityCurve: mapEquitySnapshotRowsToPoints(sampledRows),
        drawdownPercentCurve:
          mapEquitySnapshotRowsToDrawdownPercentPoints(sampledRows),
        depositLoadPercentCurve:
          mapEquitySnapshotRowsToDepositLoadPercentPoints(sampledRows),
      };
    },
  );
}
