import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { resolveTradingAccount } from "@/lib/trading/account-resolver";
import { addBangkokDays, startOfBangkokDay } from "@/lib/time";
import {
  computeCompoundedGrowth,
  depositLoadByXauusdFilledOrderVolume,
  dealNet,
  getAccountStatus,
  getLatestDealBalance,
  isTradingDeal,
  positionPips,
  sanitizeOptionalText,
} from "@/lib/trading/analytics";
import type { SerializedAccount } from "@/lib/trading/types";

export {
  buildBalanceCurve,
  buildDailyProfitSeries,
  buildFundingTotals,
  buildSymbolTradePercent,
  buildUnitDrawdownCurve,
  computeAbsoluteDrawdown,
  computeAbsoluteGain,
  computeAllTimeGrowth,
  computeAverageHoldHours,
  computeAverageStreaks,
  computeBalanceDrawdown,
  computeCompoundedGrowth,
  computeConsecutiveRunAmounts,
  computeDepositLoadPercent,
  computeTradeActivityPercent,
  computeTradesPerWeek,
  computeTradesPerYear,
  computeAnnualizedSharpeRatio,
  computeSharpeRatio,
  computeYearGrowth,
  dealNet,
  filterByDateRange,
  filterBySince,
  getLongTradeWinPercent,
  getShortTradeWinPercent,
  getSinceDate,
  getTimeframeLabel,
  getTradeWinPercent,
  isBalanceDeal,
  isFundingDeal,
  isTradingDeal,
  normalizeTradeSide,
  parseTimeframe,
  positionNetPnl,
  positionPips,
  positionProfit,
  sanitizeOptionalText,
  summarizeClosedPositions,
  startOfDay,
  endOfDay,
  summarizeTrades,
  isClosedPosition,
} from "@/lib/trading/analytics";

const LIST_CACHE_REVALIDATE_MS = 5_000;

// Autonomous card-expansion window: an account whose most recent position
// was OPENED within this window (still open or since closed) renders as the
// full card by default; quieter accounts auto-collapse to the strip.
const POSITION_OPEN_RECENT_MS = 24 * 60 * 60 * 1000;

interface AccountListCache {
  items: SerializedAccount[];
  versionKey: string;
  lastCheckedAt: number;
}

let accountListCache: AccountListCache | null = null;

async function getListVersionKey(): Promise<string> {
  // Position/OpenPosition writes don't bump account/snapshot updatedAt (the
  // worker replaces open-position rows wholesale without touching them), so
  // position-derived fields (last_position_opened_at, today_trade_count)
  // need their own max-timestamp components — otherwise the 5s cache keeps
  // serving stale activity after a new position lands.
  const [accountMax, snapshotMax, positionMax, openPositionMax] =
    await Promise.all([
      prisma.tradingAccount.aggregate({ _max: { updatedAt: true } }),
      prisma.accountSnapshot.aggregate({ _max: { updatedAt: true } }),
      prisma.position.aggregate({ _max: { openTime: true, closeTime: true } }),
      prisma.openPosition.aggregate({ _max: { openTime: true } }),
    ]);
  return [
    accountMax._max?.updatedAt?.toISOString() ?? "0",
    snapshotMax._max?.updatedAt?.toISOString() ?? "0",
    positionMax._max?.openTime?.toISOString() ?? "0",
    positionMax._max?.closeTime?.toISOString() ?? "0",
    openPositionMax._max?.openTime?.toISOString() ?? "0",
  ].join("|");
}

type AccountRecord = any;
type NumericLike = Prisma.Decimal | number;
type NullableNumericLike = NumericLike | null | undefined;
const BALANCE_SORT_EPSILON = 0.000001;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export interface AccountBundle {
  account: AccountRecord;
  latestSnapshot: AccountRecord["accountSnapshot"] | null;
}

function getLatestReportTimestamp(
  account: {
    reportDate?: Date | string | null;
    openPositions: Array<{ reportDate?: Date | string | null }>;
    deals?: Array<{ time?: Date | string | null }>;
    positions?: Array<{ closeTime?: Date | string | null }>;
  },
  latestSnapshot: { reportDate?: Date | string | null } | null | undefined,
) {
  const reportTimestamps = [
    account.reportDate,
    latestSnapshot?.reportDate,
    ...account.openPositions.map((position) => position.reportDate),
    ...(account.deals ?? []).map((deal) => deal.time),
    ...(account.positions ?? []).map((position) => position.closeTime),
  ]
    .map((value) => (value ? new Date(value).getTime() : Number.NaN))
    .filter((value) => Number.isFinite(value));

  return reportTimestamps.length ? Math.max(...reportTimestamps) : null;
}

function toNullableNumber(value: NullableNumericLike) {
  const numeric = Number(value ?? Number.NaN);
  return Number.isFinite(numeric) ? numeric : null;
}

function toNumber(value: NullableNumericLike, fallback = 0) {
  return toNullableNumber(value) ?? fallback;
}

type ReportAnchoredPosition = {
  closeTime?: Date | string | null;
  pips?: NullableNumericLike;
  symbol?: string | null;
  type?: string | null;
  openPrice?: NullableNumericLike;
  closePrice?: NullableNumericLike;
};

export function compareAccountListItems(
  a: SerializedAccount,
  b: SerializedAccount,
) {
  const tradesDelta = b.today_trade_count - a.today_trade_count;
  if (Math.abs(tradesDelta) > BALANCE_SORT_EPSILON) {
    return tradesDelta;
  }

  const growthDelta = b.today_growth_percent - a.today_growth_percent;
  if (Math.abs(growthDelta) > BALANCE_SORT_EPSILON) {
    return growthDelta;
  }

  const pipsDelta = b.today_net_pips - a.today_net_pips;
  if (Math.abs(pipsDelta) > BALANCE_SORT_EPSILON) {
    return pipsDelta;
  }

  const balanceDelta = b.balance - a.balance;
  if (Math.abs(balanceDelta) > BALANCE_SORT_EPSILON) {
    return balanceDelta;
  }

  return a.account_number.localeCompare(b.account_number, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function sortAccountListItems(items: SerializedAccount[]) {
  return [...items].sort(compareAccountListItems);
}

export function applyTodayNetPips(
  items: SerializedAccount[],
  todayNetPipsByAccountId: Map<string, number>,
) {
  return items.map((item) => ({
    ...item,
    today_net_pips: todayNetPipsByAccountId.get(item.id) ?? 0,
  }));
}

export function getReportDayWindow(anchorDate: Date) {
  const start = startOfBangkokDay(anchorDate) ?? anchorDate;
  return {
    start,
    end: new Date(start.getTime() + ONE_DAY_MS),
  };
}

function getTodayGrowthPercent(
  deals: Array<{
    time: Date | string;
    dealNo?: string;
    type?: string | null;
    comment?: string | null;
    profit?: NullableNumericLike;
    commission?: NullableNumericLike;
    swap?: NullableNumericLike;
    balance?: NullableNumericLike;
  }>,
  anchorDate: Date,
) {
  return computeCompoundedGrowth(
    deals as any,
    getReportDayWindow(anchorDate).start,
    null,
  );
}

function getTodayWeekGrowthPercent(
  deals: Array<{
    time: Date | string;
    dealNo?: string;
    type?: string | null;
    comment?: string | null;
    profit?: NullableNumericLike;
    commission?: NullableNumericLike;
    swap?: NullableNumericLike;
    balance?: NullableNumericLike;
  }>,
  anchorDate: Date,
) {
  const weekStart = addBangkokDays(
    startOfBangkokDay(anchorDate) ?? anchorDate,
    -6,
  );
  if (!weekStart) return 0;
  return computeCompoundedGrowth(deals as any, weekStart, null);
}

function getTodayNetProfit(
  deals: Array<{
    time: Date | string;
    type?: string | null;
    direction?: string | null;
    symbol?: string | null;
    profit?: NullableNumericLike;
    commission?: NullableNumericLike;
    swap?: NullableNumericLike;
  }>,
  anchorDate: Date,
) {
  const { start, end } = getReportDayWindow(anchorDate);
  const startMs = start.getTime();
  const endMs = end.getTime();

  let total = 0;
  for (const deal of deals) {
    if (!isTradingDeal(deal)) continue;
    const ts = new Date(deal.time).getTime();
    if (!Number.isFinite(ts) || ts < startMs || ts >= endMs) continue;
    total += dealNet(deal);
  }
  return total;
}

export function getTodayNetPips(
  positions: ReportAnchoredPosition[],
  anchorDate: Date,
) {
  const { start, end } = getReportDayWindow(anchorDate);
  const startMs = start.getTime();
  const endMs = end.getTime();

  return positions.reduce((total, position) => {
    if (position.closeTime == null) {
      return total;
    }

    const closeTime = new Date(position.closeTime);
    const timestamp = closeTime.getTime();
    if (
      !Number.isFinite(timestamp) ||
      timestamp < startMs ||
      timestamp >= endMs
    ) {
      return total;
    }

    const pips =
      position.pips != null
        ? Number(position.pips)
        : positionPips(position as any);
    return total + (pips ?? 0);
  }, 0);
}

export function getTodayTradeCount(
  positions: ReportAnchoredPosition[],
  anchorDate: Date,
) {
  const { start, end } = getReportDayWindow(anchorDate);
  const startMs = start.getTime();
  const endMs = end.getTime();

  let count = 0;
  for (const position of positions) {
    if (position.closeTime == null) {
      continue;
    }

    const timestamp = new Date(position.closeTime).getTime();
    if (
      !Number.isFinite(timestamp) ||
      timestamp < startMs ||
      timestamp >= endMs
    ) {
      continue;
    }

    count += 1;
  }
  return count;
}

export function serializeOpenPositions(
  openPositions: Array<{
    positionNo: string;
    openTime: Date | null;
    symbol: string;
    type: string;
    volume: number;
    price: NullableNumericLike;
    sl: NullableNumericLike;
    tp: NullableNumericLike;
    marketPrice: NullableNumericLike;
    profit: NullableNumericLike;
    swap: NullableNumericLike;
    comment: string | null;
    magic?: number | null;
  }>,
) {
  return [...openPositions]
    .sort((left, right) => {
      const leftTime = left.openTime
        ? new Date(left.openTime).getTime()
        : Number.NEGATIVE_INFINITY;
      const rightTime = right.openTime
        ? new Date(right.openTime).getTime()
        : Number.NEGATIVE_INFINITY;
      return rightTime - leftTime;
    })
    .map((position) => ({
      positionId: position.positionNo,
      openedAt: position.openTime,
      symbol: position.symbol,
      side: position.type,
      volume: position.volume,
      openPrice: Number(position.price),
      sl: position.sl == null ? null : Number(position.sl),
      tp: position.tp == null ? null : Number(position.tp),
      marketPrice: Number(position.marketPrice),
      floatingProfit: Number(position.profit),
      swap: Number(position.swap),
      comment: position.comment,
      magic: position.magic ?? null,
    }));
}

export function getAccountAnchorDate(
  bundle: AccountBundle,
  fallback = new Date(),
) {
  const { account, latestSnapshot } = bundle;
  const latestReportTimestamp = getLatestReportTimestamp(
    {
      reportDate: account.reportDate,
      openPositions: account.openPositions,
      deals: account.deals,
      positions: account.positions,
    },
    latestSnapshot,
  );
  return latestReportTimestamp ? new Date(latestReportTimestamp) : fallback;
}

export async function getAccountBundle(
  accountId: string,
  options?: { allHistory?: boolean },
): Promise<AccountBundle | null> {
  // Accepts either the internal cuid or the MT5 login (accountNo).
  const resolved = await resolveTradingAccount(accountId);
  const actualAccountId = resolved?.id ?? accountId;

  // Lazily load only the last 90 days of data to prevent timeouts on large accounts,
  // unless all history is explicitly requested.
  const sinceDate = new Date();
  if (options?.allHistory) {
    sinceDate.setTime(0); // 1970-01-01
  } else {
    // Do not use local Date setters here: persisted timestamps and report
    // boundaries must not depend on the host's configured timezone.
    sinceDate.setTime(sinceDate.getTime() - 90 * ONE_DAY_MS);
  }

  // Find the earliest open time for positions closed within the window. This ensures
  // we fetch all relevant deals, even for positions opened before the window.
  // Aggregate in DB — index-backed, one row transferred instead of every
  // openTime in the window (allHistory rebuilds used to ship ~all rows).
  const earliestOpen = await prisma.position.aggregate({
    where: {
      tradingAccountId: actualAccountId,
      closeTime: { gte: sinceDate },
    },
    _min: { openTime: true },
  });
  const earliestOpenTime =
    earliestOpen._min.openTime && new Date(earliestOpen._min.openTime) < sinceDate
      ? new Date(earliestOpen._min.openTime)
      : sinceDate;

  const account = await prisma.tradingAccount.findUnique({
    where: {
      id: actualAccountId,
    },
    include: {
      accountSnapshot: true,
      accountReportResult: true,
      equitySnapshots: {
        where: { ts: { gte: earliestOpenTime } },
        orderBy: { ts: "asc" },
        select: {
          ts: true,
          equity: true,
          margin: true,
          balance: true,
          floatingPl: true,
          depositLoad: true,
          maxDepositLoad: true,
        },
      },
      openPositions: {
        orderBy: [{ symbol: "asc" }, { positionNo: "asc" }],
      },
      positions: {
        where: { closeTime: { gte: sinceDate } },
        orderBy: [{ closeTime: "asc" }, { positionNo: "asc" }],
      },
      deals: {
        where: { time: { gte: earliestOpenTime } },
        orderBy: [{ time: "asc" }, { dealNo: "asc" }],
      },
      orders: {
        where: { timeSetup: { gte: earliestOpenTime } },
        orderBy: [{ timeSetup: "asc" }, { orderTicket: "asc" }],
      },
    },
  });

  if (!account) {
    return null;
  }

  return {
    latestSnapshot: account.accountSnapshot,
    account,
  };
}

export function serializeAccountBundle(
  bundle: AccountBundle | null,
): SerializedAccount | null {
  if (!bundle) {
    return null;
  }

  const { account, latestSnapshot } = bundle;
  const openPositions = account.openPositions as Array<{
    reportDate?: Date | string | null;
    profit?: NullableNumericLike;
    openTime?: Date | string | null;
  }>;
  const orders = (account.orders ?? []) as Array<{
    symbol?: string | null;
    state?: string | null;
    volume?: NullableNumericLike;
  }>;
  const latestReportTimestamp = getLatestReportTimestamp(
    {
      reportDate: account.reportDate,
      openPositions,
      deals: account.deals,
      positions: account.positions,
    },
    latestSnapshot,
  );
  // Autonomous expansion signal: the most recent position OPEN time across
  // currently-open rows and the fetched close-window rows. A position opened
  // within the last 24h always lands in one of those two sets (still open →
  // openPositions; since closed → closeTime >= openTime keeps it inside the
  // 7-day close window the list query fetches). Evaluated here at
  // serialization time so the client renders a stable per-payload boolean
  // instead of consulting the wall clock during render.
  const lastPositionOpenedTimes = [
    ...openPositions.map((position) => position.openTime),
    ...((account.positions ?? []) as Array<{
      openTime?: Date | string | null;
    }>).map((position) => position.openTime),
  ]
    .map((value) => (value ? new Date(value).getTime() : Number.NaN))
    .filter((value) => Number.isFinite(value));
  const positionOpenedRecently =
    lastPositionOpenedTimes.length > 0 &&
    Date.now() - Math.max(...lastPositionOpenedTimes) < POSITION_OPEN_RECENT_MS;
  const anchorDate = latestReportTimestamp
    ? new Date(latestReportTimestamp)
    : new Date();

  const equity = toNumber(
    latestSnapshot?.equity,
    getLatestDealBalance(account.deals, 0),
  );
  const balance = toNumber(
    latestSnapshot?.balance,
    getLatestDealBalance(account.deals, 0),
  );
  const margin = toNullableNumber(latestSnapshot?.margin);
  // Product metric: deposit load starts only after at least one filled XAUUSD
  // order. It estimates margin used from filled XAUUSD lots (lots x 410.3) and
  // divides by balance, while broker margin stays on separate margin fields.
  const depositLoad = depositLoadByXauusdFilledOrderVolume({
    balance,
    orders: orders.map((order) => ({
      symbol: String(order.symbol ?? ""),
      state: order.state,
      volumeLots: Number(order.volume ?? 0),
    })),
  });

  return {
    id: account.id,
    account_number: account.accountNo,
    owner_name: sanitizeOptionalText(account.accountName),
    currency: sanitizeOptionalText(account.currency) ?? "USD",
    server: sanitizeOptionalText(account.serverName) ?? "",
    status: getAccountStatus(account.updatedAt),
    last_updated: latestReportTimestamp
      ? new Date(latestReportTimestamp)
      : null,
    today_growth_percent: getTodayGrowthPercent(account.deals, anchorDate),
    week_growth_percent: getTodayWeekGrowthPercent(account.deals, anchorDate),
    today_net_profit: getTodayNetProfit(account.deals, anchorDate),
    today_net_pips: getTodayNetPips(account.positions, anchorDate),
    today_trade_count: getTodayTradeCount(account.positions, anchorDate),
    open_position_count: openPositions.length,
    position_opened_recently: positionOpenedRecently,
    balance,
    equity,
    floating_pl: toNumber(
      latestSnapshot?.floatingPl,
      openPositions.reduce(
        (total, position) => total + Number(position.profit ?? 0),
        0,
      ),
    ),
    margin,
    margin_level: toNullableNumber(latestSnapshot?.marginLevel),
    deposit_load_source: "xauusd_filled_order_volume",
    deposit_load_pct: depositLoad.depositLoadPct,
    deposit_load_margin_used: depositLoad.marginUsedUsd,
    xauusd_filled_lots: depositLoad.xauusdLots,
  };
}

const ACCOUNT_STALE_MS = 24 * 60 * 60 * 1000; // hide accounts not seen by bridge/manual import for >24h

export function getAccountListMetricsSince(now = new Date()) {
  return addBangkokDays(startOfBangkokDay(now) ?? now, -7) ?? now;
}

async function fetchAccountListItems() {
  const now = new Date();
  const activeSince = new Date(now.getTime() - ACCOUNT_STALE_MS);
  const metricsSince = getAccountListMetricsSince(now);
  const [accounts, priorBalances] = await Promise.all([
    prisma.tradingAccount.findMany({
      where: {
        // Active = seen recently by the bridge. Prefer lastSeenAt (pure
        // liveness, does not feed cache version keys); fall back to
        // updatedAt for rows written before the column existed.
        OR: [
          { lastSeenAt: { gte: activeSince } },
          { lastSeenAt: null, updatedAt: { gte: activeSince } },
        ],
      },
      select: {
        id: true,
        accountNo: true,
        accountName: true,
        currency: true,
        serverName: true,
        reportDate: true,
        updatedAt: true,
        lastSeenAt: true,
        accountSnapshot: true,
        deals: {
          where: { time: { gte: metricsSince } },
          select: {
            time: true,
            dealNo: true,
            symbol: true,
            type: true,
            direction: true,
            comment: true,
            profit: true,
            commission: true,
            swap: true,
            balance: true,
          },
          orderBy: [{ time: "asc" }, { dealNo: "asc" }],
        },
        openPositions: {
          select: {
            reportDate: true,
            profit: true,
            openTime: true,
          },
        },
        orders: {
          where: { state: "filled" },
          select: {
            symbol: true,
            state: true,
            volume: true,
          },
        },
        positions: {
          where: { closeTime: { gte: metricsSince } },
          select: {
            closeTime: true,
            openTime: true,
            pips: true,
            symbol: true,
            type: true,
            openPrice: true,
            closePrice: true,
          },
        },
      },
      orderBy: {
        accountNo: "asc",
      },
    }),
    prisma.deal.groupBy({
      by: ["tradingAccountId"],
      where: {
        time: { lt: metricsSince },
        tradingAccount: {
          OR: [
            { lastSeenAt: { gte: activeSince } },
            { lastSeenAt: null, updatedAt: { gte: activeSince } },
          ],
        },
      },
      _sum: { profit: true, commission: true, swap: true },
    }),
  ]);
  const priorBalanceByAccount = new Map(
    priorBalances.map((row: any) => [
      row.tradingAccountId,
      Number(row._sum.profit ?? 0) +
        Number(row._sum.commission ?? 0) +
        Number(row._sum.swap ?? 0),
    ]),
  );
  const items = accounts
    .map((account: any) => {
      const priorBalance = priorBalanceByAccount.get(account.id);
      const deals =
        priorBalance === undefined
          ? account.deals
          : [
              {
                time: new Date(metricsSince.getTime() - 1),
                dealNo: "account-list-baseline",
                type: "trade",
                profit: priorBalance,
                commission: 0,
                swap: 0,
                balance: null,
              },
              ...account.deals,
            ];
      return serializeAccountBundle({
        account: { ...account, deals },
        latestSnapshot: account.accountSnapshot,
      });
    })
    .filter(
      (item: SerializedAccount | null): item is SerializedAccount =>
        item !== null,
    );

  return sortAccountListItems(items);
}

export async function getAccountListItems(): Promise<SerializedAccount[]> {
  const now = Date.now();
  const existing = accountListCache;

  if (existing && now - existing.lastCheckedAt < LIST_CACHE_REVALIDATE_MS) {
    return existing.items;
  }

  const versionKey = await getListVersionKey();

  if (existing && existing.versionKey === versionKey) {
    existing.lastCheckedAt = now;
    return existing.items;
  }

  const items = await fetchAccountListItems();
  accountListCache = { items, versionKey, lastCheckedAt: now };
  return items;
}
