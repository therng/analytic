// Timeframe-invariant precomputation for buildTimeframeView. Everything in
// here depends only on the account source (deals/positions/orders/report
// time), NOT on the selected timeframe — so it is computed once per source
// version (worker-side, cached alongside the worker's parsed source) instead
// of once per timeframe build. On a 28k-deal account this moves ~1s of
// full-source rescans (all-time growth, yearly series, deal-comment maps,
// order maps) plus the ~0.85s of bundle precompute off every single build.
//
// Behavior note: buildTimeframePrecomputed reproduces the exact per-build
// computations it replaces (same iteration order, same tie-breaking) — the
// view-build contract fixture pins byte-identical output.
import {
  computeAbsoluteGain,
  computeAllTimeGrowth,
  computeCompoundedGrowth,
  computeYearGrowth,
  isTradingDeal,
} from "@/lib/trading/account-data";
import {
  endOfBangkokMonth,
  getBangkokMonthIndex,
  getBangkokYear,
  startOfBangkokMonth,
} from "@/lib/time";
import type {
  AccountPreaggregatedSource,
  DealRow,
  OrderRow,
} from "@/lib/trading/preaggregated-cache";
import { buildPipsSummaryRows } from "@/lib/trading/preaggregated/pips-summary";
import type { Timeframe } from "@/lib/trading/types";

export type DealEntry = { comment: string | null };

export type TimeframeInvariantPrecomputed = {
  /** Per-period pips rows — pipsSummary view. */
  pipsSummaryRows: NonNullable<AccountPreaggregatedSource["pipsSummaryRows"]>;
  /** Current-year monthly compounded growth — growth view. */
  monthlyGrowthSeries: NonNullable<AccountPreaggregatedSource["monthlyGrowthSeries"]>;
  /** Lifetime aggregates — growth view. */
  allTimeGrowth: number;
  ytdGrowth: number;
  allTimeAbsoluteGain: number;
  reportYear: number;
  yearlySeries: Array<{ year: number; value: number }>;
  /** Deal-comment enrichment maps for historyPositions (symbol:seconds:price). */
  openingByPriceKey: Map<string, DealEntry>;
  openingQueueByTimeKey: Map<string, DealEntry[]>;
  closingByPriceKey: Map<string, DealEntry>;
  closingQueueByTimeKey: Map<string, DealEntry[]>;
  /** Order SL/TP lookups by position id / ticket. */
  orderByPositionId: Map<string, OrderRow>;
  orderByTicket: Map<string, OrderRow>;
};

const MONTH_LABELS = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2024, index, 1))),
);

function buildMonthlyGrowthSeries(deals: DealRow[], reportTime: Date) {
  const year = getBangkokYear(reportTime) ?? reportTime.getUTCFullYear();
  return Array.from({ length: 12 }, (_, index) => {
    const utcMonthStart = new Date(Date.UTC(year, index, 1));
    const start = startOfBangkokMonth(utcMonthStart) ?? utcMonthStart;
    const end = endOfBangkokMonth(start) ?? start;
    return {
      month: MONTH_LABELS[getBangkokMonthIndex(start) ?? index] ?? "",
      value: computeCompoundedGrowth(deals, start, end),
    };
  });
}

function buildDealCommentMaps(deals: DealRow[]) {
  // Build separate maps for opening (direction="in") and closing (direction="out") deals.
  // - Opening deal comment → shown as the trade note in UI (e.g. "Axonshift-N Buy").
  // - Closing deal comment → parsed for "[sl <price>]" / "[tp <price>]" tags to override
  //   the displayed SL/TP and flag the close reason.
  // Match positions to deals via "symbol:seconds:price" (price disambiguates basket closes
  // at the same instant); fall back to a FIFO queue on "symbol:seconds" when prices collide.
  const openingByPriceKey = new Map<string, DealEntry>();
  const openingQueueByTimeKey = new Map<string, DealEntry[]>();
  const closingByPriceKey = new Map<string, DealEntry>();
  const closingQueueByTimeKey = new Map<string, DealEntry[]>();
  for (const deal of deals) {
    if (!isTradingDeal(deal)) continue;
    const dir = (deal.direction ?? "").toLowerCase().trim();
    if (dir !== "in" && dir !== "out") continue;
    if (!deal.symbol || !deal.time) continue;
    const secs = Math.floor(new Date(deal.time).getTime() / 1000);
    const timeKey = `${deal.symbol}:${secs}`;
    const entry: DealEntry = { comment: deal.comment ?? null };
    const byPriceKey = dir === "in" ? openingByPriceKey : closingByPriceKey;
    const queueByTimeKey =
      dir === "in" ? openingQueueByTimeKey : closingQueueByTimeKey;
    if (deal.price != null) {
      const priceKey = `${timeKey}:${Number(deal.price).toFixed(5)}`;
      if (!byPriceKey.has(priceKey)) {
        byPriceKey.set(priceKey, entry);
      }
    }
    const queue = queueByTimeKey.get(timeKey);
    if (queue) {
      queue.push(entry);
    } else {
      queueByTimeKey.set(timeKey, [entry]);
    }
  }
  return {
    openingByPriceKey,
    openingQueueByTimeKey,
    closingByPriceKey,
    closingQueueByTimeKey,
  };
}

function buildOrderMaps(orders: OrderRow[]) {
  const upsertOrder = (
    map: Map<string, OrderRow>,
    key: string,
    order: OrderRow,
  ) => {
    const current = map.get(key);
    if (
      !current ||
      (order.sl && Number(order.sl) !== 0) ||
      (order.tp && Number(order.tp) !== 0)
    ) {
      map.set(key, order);
    }
  };
  const orderByPositionId = new Map<string, OrderRow>();
  const orderByTicket = new Map<string, OrderRow>();
  for (const order of orders) {
    if (order.positionId) {
      upsertOrder(orderByPositionId, order.positionId, order);
    }
    if (order.orderTicket) {
      upsertOrder(orderByTicket, order.orderTicket, order);
    }
  }
  return { orderByPositionId, orderByTicket };
}

/**
 * Compute every timeframe-invariant input buildTimeframeView needs. Source
 * fields that already carry a precomputed value (when present) are reused
 * verbatim so inline fallback output stays identical to the worker path.
 */
export function buildTimeframePrecomputed(
  source: Omit<AccountPreaggregatedSource, "timeframe"> & {
    timeframe?: Timeframe;
  },
): TimeframeInvariantPrecomputed {
  const { deals, positions, orders, reportTime } = source;
  const year = getBangkokYear(reportTime) ?? reportTime.getUTCFullYear();

  const years = deals
    .map((deal) => getBangkokYear(deal.time))
    .filter((value): value is number => Number.isFinite(value));
  const firstYear = years.length ? Math.min(...years) : year;

  return {
    pipsSummaryRows:
      source.pipsSummaryRows ?? buildPipsSummaryRows(deals, positions, reportTime),
    monthlyGrowthSeries:
      source.monthlyGrowthSeries ?? buildMonthlyGrowthSeries(deals, reportTime),
    allTimeGrowth: computeAllTimeGrowth(deals),
    ytdGrowth: computeYearGrowth(deals, year),
    allTimeAbsoluteGain: computeAbsoluteGain(deals, null),
    reportYear: year,
    yearlySeries: Array.from({ length: year - firstYear + 1 }, (_, index) => {
      const itemYear = firstYear + index;
      return {
        year: itemYear,
        value: computeYearGrowth(deals, itemYear),
      };
    }),
    ...buildDealCommentMaps(deals),
    ...buildOrderMaps(orders),
  };
}
