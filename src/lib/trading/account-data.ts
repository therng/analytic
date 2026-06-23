import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { addBangkokDays, startOfBangkokDay, startOfThaiDayInTableTime } from "@/lib/time";
import {
  computeCompoundedGrowth,
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
  computeBalanceDrawdown,
  computeCompoundedGrowth,
  computeConsecutiveRunAmounts,
  computeDepositLoadPercent,
  computeTradeActivityPercent,
  computeTradesPerWeek,
  computeTradesPerYear,
  computeAnnualizedSharpeRatio,
  computeSharpeRatio,
  computeStreaks,
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

interface AccountListCache {
  items: SerializedAccount[];
  versionKey: string;
  lastCheckedAt: number;
}

let accountListCache: AccountListCache | null = null;

async function getListVersionKey(): Promise<string> {
  const [accountMax, snapshotMax] = await Promise.all([
    (prisma as any).tradingAccount.aggregate({ _max: { updatedAt: true } }),
    (prisma as any).accountSnapshot.aggregate({ _max: { updatedAt: true } }),
  ]);
  return [
    accountMax._max?.updatedAt?.toISOString() ?? "0",
    snapshotMax._max?.updatedAt?.toISOString() ?? "0",
  ].join("|");
}

const accountInclude = {
  accountSnapshot: true,
  accountReportResult: true,
  equityHistory: {
    orderBy: { reportDate: "asc" },
    select: { reportDate: true, equity: true, margin: true, balance: true, floatingPl: true },
  },
  openPositions: {
    orderBy: [{ symbol: "asc" }, { positionNo: "asc" }],
  },
  positions: {
    orderBy: [{ closeTime: "asc" }, { positionNo: "asc" }],
  },
  deals: {
    orderBy: [{ time: "asc" }, { dealNo: "asc" }],
  },
} as const;

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
  },
  latestSnapshot: { reportDate?: Date | string | null } | null | undefined,
) {
  const reportTimestamps = [
    account.reportDate,
    latestSnapshot?.reportDate,
    ...account.openPositions.map((position) => position.reportDate),
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

export function compareAccountListItems(a: SerializedAccount, b: SerializedAccount) {
  const growthDelta = b.today_growth_percent - a.today_growth_percent;
  if (Math.abs(growthDelta) > BALANCE_SORT_EPSILON) {
    return growthDelta;
  }

  const pipsDelta = b.today_net_pips - a.today_net_pips;
  if (Math.abs(pipsDelta) > BALANCE_SORT_EPSILON) {
    return pipsDelta;
  }

  const profitDelta = b.today_net_profit - a.today_net_profit;
  if (Math.abs(profitDelta) > BALANCE_SORT_EPSILON) {
    return profitDelta;
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

export function applyTodayNetPips(items: SerializedAccount[], todayNetPipsByAccountId: Map<string, number>) {
  return items.map((item) => ({
    ...item,
    today_net_pips: todayNetPipsByAccountId.get(item.id) ?? 0,
  }));
}

export function getReportDayWindow(anchorDate: Date) {
  const start = startOfThaiDayInTableTime(anchorDate) ?? startOfBangkokDay(anchorDate) ?? anchorDate;
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
  return computeCompoundedGrowth(deals as any, getReportDayWindow(anchorDate).start, null);
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
  const weekStart = addBangkokDays(startOfBangkokDay(anchorDate) ?? anchorDate, -6);
  if (!weekStart) return 0;
  return computeCompoundedGrowth(deals as any, weekStart, null);
}

function getTodayNetProfit(
  deals: Array<{
    time: Date | string;
    type?: string | null;
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
    if (!isTradingDeal(deal.type)) continue;
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
    if (!Number.isFinite(timestamp) || timestamp < startMs || timestamp >= endMs) {
      return total;
    }

    const pips = position.pips != null ? Number(position.pips) : positionPips(position as any);
    return total + (pips ?? 0);
  }, 0);
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
  }>,
) {
  return [...openPositions]
    .sort((left, right) => {
      const leftTime = left.openTime ? new Date(left.openTime).getTime() : Number.NEGATIVE_INFINITY;
      const rightTime = right.openTime ? new Date(right.openTime).getTime() : Number.NEGATIVE_INFINITY;
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
    }));
}

export function getAccountAnchorDate(bundle: AccountBundle, fallback = new Date()) {
  const { account, latestSnapshot } = bundle;
  const latestReportTimestamp = getLatestReportTimestamp(
    {
      reportDate: account.reportDate,
      openPositions: account.openPositions,
    },
    latestSnapshot,
  );
  return latestReportTimestamp ? new Date(latestReportTimestamp) : fallback;
}

export async function getAccountBundle(accountId: string): Promise<AccountBundle | null> {
  const account = await (prisma as any).tradingAccount.findUnique({
    where: {
      id: accountId,
    },
    include: accountInclude,
  });

  if (!account) {
    return null;
  }

  return {
    latestSnapshot: account.accountSnapshot,
    account,
  };
}

export function serializeAccountBundle(bundle: AccountBundle | null): SerializedAccount | null {
  if (!bundle) {
    return null;
  }

  const { account, latestSnapshot } = bundle;
  const openPositions = account.openPositions as Array<{
    reportDate?: Date | string | null;
    profit?: NullableNumericLike;
  }>;
  const latestReportTimestamp = getLatestReportTimestamp(
    {
      reportDate: account.reportDate,
      openPositions,
    },
    latestSnapshot,
  );
  const anchorDate = latestReportTimestamp ? new Date(latestReportTimestamp) : new Date();

  return {
    id: account.id,
    account_number: account.accountNo,
    owner_name: sanitizeOptionalText(account.accountName),
    currency: sanitizeOptionalText(account.currency) ?? "USD",
    server: sanitizeOptionalText(account.serverName) ?? "",
    status: getAccountStatus(account.updatedAt),
    last_updated: latestReportTimestamp ? new Date(latestReportTimestamp) : null,
    today_growth_percent: getTodayGrowthPercent(account.deals, anchorDate),
    week_growth_percent: getTodayWeekGrowthPercent(account.deals, anchorDate),
    today_net_profit: getTodayNetProfit(account.deals, anchorDate),
    today_net_pips: getTodayNetPips(account.positions, anchorDate),
    balance: getLatestDealBalance(account.deals, latestSnapshot?.balance ?? 0),
    equity: toNumber(latestSnapshot?.equity, getLatestDealBalance(account.deals, 0)),
    floating_pl: toNumber(
      latestSnapshot?.floatingPl,
      openPositions.reduce((total, position) => total + Number(position.profit ?? 0), 0),
    ),
    margin: toNullableNumber(latestSnapshot?.margin),
    margin_level: toNullableNumber(latestSnapshot?.marginLevel),
  };
}

async function fetchAccountListItems() {
  const accounts = await (prisma as any).tradingAccount.findMany({
    select: {
      id: true,
      accountNo: true,
      accountName: true,
      currency: true,
      serverName: true,
      reportDate: true,
      updatedAt: true,
      accountSnapshot: true,
      deals: {
        select: {
          time: true,
          dealNo: true,
          type: true,
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
        },
      },
      positions: {
        select: {
          closeTime: true,
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
  });
  const items = accounts.map((account: any) => {
    const openPositions = account.openPositions as Array<{
      reportDate?: Date | string | null;
      profit?: NullableNumericLike;
    }>;
    const latestReportTimestamp = getLatestReportTimestamp(
      {
        reportDate: account.reportDate,
        openPositions,
      },
      account.accountSnapshot,
    );
    const anchorDate = latestReportTimestamp ? new Date(latestReportTimestamp) : new Date();

    return {
      id: account.id,
      account_number: account.accountNo,
      owner_name: sanitizeOptionalText(account.accountName),
      currency: sanitizeOptionalText(account.currency) ?? "USD",
      server: sanitizeOptionalText(account.serverName) ?? "",
      status: getAccountStatus(account.updatedAt),
      today_growth_percent: getTodayGrowthPercent(account.deals, anchorDate),
      week_growth_percent: getTodayWeekGrowthPercent(account.deals, anchorDate),
      today_net_profit: getTodayNetProfit(account.deals, anchorDate),
      today_net_pips: getTodayNetPips(account.positions, anchorDate),
      balance: getLatestDealBalance(account.deals, account.accountSnapshot?.balance ?? 0),
      equity: toNumber(account.accountSnapshot?.equity, getLatestDealBalance(account.deals, 0)),
      floating_pl: toNumber(
        account.accountSnapshot?.floatingPl,
        openPositions.reduce((total, position) => total + Number(position.profit ?? 0), 0),
      ),
      margin: toNullableNumber(account.accountSnapshot?.margin),
      margin_level: toNullableNumber(account.accountSnapshot?.marginLevel),
      last_updated: latestReportTimestamp ? new Date(latestReportTimestamp) : null,
    } satisfies SerializedAccount;
  });

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

export async function getEquityCurve(
  accountId: string,
  since?: Date,
): Promise<Array<{ reportDate: Date; equity: number; margin: number; balance: number }>> {
  const rows = await (prisma as any).equityHistory.findMany({
    where: {
      tradingAccountId: accountId,
      ...(since ? { reportDate: { gte: since } } : {}),
    },
    orderBy: { reportDate: "asc" },
    select: { reportDate: true, equity: true, margin: true, balance: true },
  });
  return rows.map((r: any) => ({
    reportDate: r.reportDate,
    equity: Number(r.equity),
    margin: Number(r.margin),
    balance: Number(r.balance),
  }));
}
