import type { Timeframe, BalanceEventPoint } from "@/lib/trading/types";
import { computeAbsoluteGain as computeAbsoluteGainCore } from "./core/growth";
import {
  addBangkokDays,
  endOfBangkokDay,
  getBangkokDateKey,
  startOfBangkokDay,
} from "@/lib/time";

type NumericLike = number | { valueOf(): unknown } | null | undefined;

type TimedRow = {
  time: Date | string;
  dealId?: string;
  dealNo?: string;
};

type BalanceRow = TimedRow & {
  type?: string | null;
  direction?: string | null;
  comment?: string | null;
  profit?: NumericLike;
  commission?: NumericLike;
  swap?: NumericLike;
  balanceAfter?: NumericLike;
  balance?: NumericLike;
  symbol?: string | null;
};

type PositionMetricRow = {
  closeTime?: Date | string | null;
  outTime?: Date | string | null;
  openTime?: Date | string | null;
  inTime?: Date | string | null;
  positionNo?: string | null;
  positionId?: string | null;
  type?: string | null;
  direction?: string | null;
  profit?: NumericLike;
  commission?: NumericLike;
  swap?: NumericLike;
};

const EMPTY_TEXT_VALUES = new Set(["unknown", "n/a", "na", "--"]);
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

const RX_DEPOSIT = /deposit/i;
const RX_WITHDRAWAL = /withdraw/i;
const RX_ADJUSTMENT = /balance adjustment/i;
const RX_GENERIC_BAL =
  /credit|correction|bonus|fee|charge|interest|tax|agent|dividend/i;

function parseTimestamp(time: Date | string | null | undefined): number {
  if (!time) return NaN;
  return typeof time === "string" ? Date.parse(time) : time.getTime();
}

function getDealSortKey(row: { dealId?: string; dealNo?: string }) {
  return String(row.dealId ?? row.dealNo ?? "");
}

function getPositionSortKey(row: {
  positionNo?: string | null;
  positionId?: string | null;
}) {
  return String(row.positionNo ?? row.positionId ?? "");
}

// Returns true when a deal should be counted as a trade entry in the balance curve.
// A deal is a trade if its type field is present (including empty string, which MT5 emits
// for regular trade deals) OR it has a non-empty comment.
// Only skip deals where type is null/undefined AND comment is null/empty — these are
// system/internal entries with no classification at all.
function hasDealTypeOrComment(deal: {
  type?: string | null;
  comment?: string | null;
}): boolean {
  return deal.type != null || (deal.comment != null && deal.comment !== "");
}

// Pre-calculate timestamps and keys to ensure O(N log N) sorting is extremely fast
function sortDeals<T extends TimedRow>(deals: T[]): T[] {
  return deals
    .map((deal) => ({
      deal,
      ts: parseTimestamp(deal.time),
      key: getDealSortKey(deal),
    }))
    .sort((a, b) => a.ts - b.ts || a.key.localeCompare(b.key))
    .map((x) => x.deal);
}

function getDealBalanceValue(row: {
  balanceAfter?: NumericLike;
  balance?: NumericLike;
}) {
  const value = Number(row.balanceAfter ?? row.balance ?? Number.NaN);
  return Number.isFinite(value) ? value : null;
}

type BalanceOperationKind =
  "deposit" | "withdrawal" | "balance-adjustment" | "balance";

function classifyBalanceOperation(
  type: string | null | undefined,
  comment: string | null | undefined,
  delta: number | null = null,
): BalanceOperationKind | null {
  const t = (type || "").toLowerCase().trim();
  const c = (comment || "").toLowerCase().trim();
  if (!t && !c) return null;

  const text = `${t} ${c}`;
  if (RX_DEPOSIT.test(text)) return "deposit";
  if (RX_WITHDRAWAL.test(text)) return "withdrawal";
  if (RX_ADJUSTMENT.test(text) || (t === "balance" && c.includes("adjustment")))
    return "balance-adjustment";
  if (RX_GENERIC_BAL.test(text)) return "balance";

  if (t === "balance") {
    if ((delta ?? 0) > 0) return "deposit";
    if ((delta ?? 0) < 0) return "withdrawal";
    return "balance";
  }

  return null;
}

function getTradeMetrics(
  deals: BalanceRow[],
  start: Date | null,
  end: Date | null = null,
) {
  const sorted = sortDeals(deals);
  const startTime = start ? start.getTime() : 0;
  const endTime = end ? end.getTime() : Infinity;

  let firstDeposit = 0;
  let totalDeposits = 0;
  let hasDeposit = false;

  for (const deal of sorted) {
    const delta = dealNet(deal);
    const op = classifyBalanceOperation(deal.type, deal.comment, delta);
    if (op === "deposit" && delta > 0) {
      if (!hasDeposit) {
        firstDeposit = delta;
        hasDeposit = true;
      }
      if (parseTimestamp(deal.time) <= endTime) {
        totalDeposits += delta;
      }
    }
  }

  if (!hasDeposit) {
    const firstKnown = sorted.find((d) => getDealBalanceValue(d) !== null);
    if (firstKnown) {
      firstDeposit = Number(getDealBalanceValue(firstKnown));
      totalDeposits = firstDeposit;
    }
  }

  // Find the first deal with a known balance in the sorted deals list
  let firstKnownIndex = -1;
  let firstKnownBalance = null;
  for (let i = 0; i < sorted.length; i++) {
    const b = getDealBalanceValue(sorted[i]);
    if (b !== null) {
      firstKnownIndex = i;
      firstKnownBalance = b;
      break;
    }
  }

  let calculatedStartBalance = firstDeposit;
  if (firstKnownIndex !== -1 && firstKnownBalance !== null) {
    let bal = firstKnownBalance;
    for (let i = firstKnownIndex; i > 0; i--) {
      bal -= dealNet(sorted[i]);
    }
    calculatedStartBalance = bal;
  }

  let runningBalance = firstKnownIndex !== -1 ? calculatedStartBalance : 0;
  let startBalance =
    firstKnownIndex !== -1 ? calculatedStartBalance : firstDeposit;
  const points: Array<{ time: number; balance: number; delta: number }> = [];

  for (const deal of sorted) {
    const ts = parseTimestamp(deal.time);
    if (ts > endTime) break;

    const delta = dealNet(deal);
    const op = classifyBalanceOperation(deal.type, deal.comment, delta);
    const shouldTrackBalance = op !== null || hasDealTypeOrComment(deal);
    if (shouldTrackBalance) {
      const providedBalance = getDealBalanceValue(deal);
      runningBalance =
        providedBalance !== null ? providedBalance : runningBalance + delta;
      if (ts < startTime) {
        startBalance = runningBalance;
      } else {
        points.push({ time: ts, balance: runningBalance, delta });
      }
    }
  }

  const endBalance =
    points.length > 0 ? points[points.length - 1].balance : startBalance;

  return {
    points,
    initialDeposit: firstDeposit,
    totalDeposits: Math.max(totalDeposits, firstDeposit),
    startBalance,
    endBalance,
  };
}

function toIsoDay(value: Date | string) {
  return getBangkokDateKey(value);
}

function getPositionCloseTime(row: {
  closeTime?: Date | string | null;
  outTime?: Date | string | null;
}) {
  return row.outTime ?? row.closeTime ?? null;
}

function getPositionOpenTime(row: {
  openTime?: Date | string | null;
  inTime?: Date | string | null;
}) {
  return row.inTime ?? row.openTime ?? null;
}

export function sanitizeOptionalText(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return EMPTY_TEXT_VALUES.has(normalized.toLowerCase()) ? null : normalized;
}

export function parseTimeframe(value: string | null): Timeframe {
  switch (value) {
    case "1d":
    case "day":
      return "1d";
    case "1w":
    case "w":
    case "5d":
    case "week":
      return "1w";
    case "1m":
    case "m":
    case "month":
      return "1m";
    case "3m":
      return "3m";
    case "6m":
      return "6m";
    case "1y":
    case "year":
      return "1y";
    case "a":
    case "all":
    case "all-time":
    default:
      return "all";
  }
}

export function startOfDay(date: Date) {
  return startOfBangkokDay(date) ?? new Date(date.getTime());
}

export function endOfDay(date: Date) {
  return endOfBangkokDay(date) ?? new Date(date.getTime());
}

export function getSinceDate(timeframe: Timeframe, now = new Date()) {
  switch (timeframe) {
    case "1d":
      return startOfDay(now);
    case "1w":
      return addBangkokDays(startOfDay(now), -7);
    case "1m":
      return addBangkokDays(startOfDay(now), -30);
    case "3m":
      return addBangkokDays(startOfDay(now), -90);
    case "6m":
      return addBangkokDays(startOfDay(now), -180);
    case "1y":
      return addBangkokDays(startOfDay(now), -365);
    default:
      return null;
  }
}

export function getTimeframeLabel(timeframe: Timeframe) {
  switch (timeframe) {
    case "1d":
      return "D";
    case "1w":
      return "W";
    case "1m":
      return "M";
    case "3m":
      return "3M";
    case "6m":
      return "6M";
    case "1y":
      return "1Y";
    default:
      return "A";
  }
}

export function getAccountStatus(
  lastUpdated: Date | string | null | undefined,
  activeWindowMinutes = 7,
) {
  const timestamp = parseTimestamp(lastUpdated);
  if (
    !Number.isFinite(timestamp) ||
    timestamp > Date.now() + MAX_FUTURE_SKEW_MS
  )
    return "Inactive" as const;
  return Date.now() - timestamp <= activeWindowMinutes * 60_000
    ? ("Active" as const)
    : ("Inactive" as const);
}

export function filterBySince<T>(
  rows: T[],
  getTimestamp: (row: T) => Date | string | null | undefined,
  since: Date | null,
) {
  if (!since) return rows;
  const minimum = since.getTime();
  return rows.filter((row) => {
    const ts = parseTimestamp(getTimestamp(row));
    return Number.isFinite(ts) && ts >= minimum;
  });
}

export function filterByDateRange<T>(
  rows: T[],
  getTimestamp: (row: T) => Date | string | null | undefined,
  start: Date | null,
  end: Date | null = null,
) {
  const min = start ? start.getTime() : null;
  const max = end ? end.getTime() : null;
  return rows.filter((row) => {
    const ts = parseTimestamp(getTimestamp(row));
    if (!Number.isFinite(ts)) return false;
    if (min !== null && ts < min) return false;
    if (max !== null && ts > max) return false;
    return true;
  });
}

export function dealNet(row: {
  profit?: NumericLike;
  commission?: NumericLike;
  swap?: NumericLike;
}) {
  return (
    Number(row.profit ?? 0) +
    Number(row.commission ?? 0) +
    Number(row.swap ?? 0)
  );
}

export const positionNetPnl = dealNet;
export const positionProfit = dealNet;

export function normalizeTradeSide(
  type: string | null | undefined,
  direction: string | null | undefined,
) {
  const t = (type || "").toLowerCase().trim();
  if (t === "buy" || t === "sell") return t;
  const d = (direction || "").toLowerCase().trim();
  if (d === "buy" || d === "sell") return d;
  return t || d || "unknown";
}

export function isBalanceDeal(
  type: string | null | undefined,
  comment?: string | null,
  delta?: number | null,
) {
  return classifyBalanceOperation(type, comment, delta ?? null) !== null;
}

export const isFundingDeal = isBalanceDeal;

type TradingDealLike = {
  type?: string | null;
  direction?: string | null;
  symbol?: string | null;
};

export function isTradingDeal(
  typeOrDeal: string | null | undefined | TradingDealLike,
  direction?: string | null,
  symbol?: string | null,
) {
  if (typeof typeOrDeal === "object" && typeOrDeal !== null) {
    const d = (typeOrDeal.direction || "").trim();
    const s = (typeOrDeal.symbol || "").trim();
    if (d && s) return true;
    typeOrDeal = typeOrDeal.type;
  } else if ((direction || "").trim() && (symbol || "").trim()) {
    return true;
  }

  const t = (typeOrDeal || "").toLowerCase().trim();
  if (!t || isBalanceDeal(t)) return false;
  if (t === "trade") return true;
  return t.includes("buy") || t.includes("sell");
}

export function getLatestDealBalance(
  deals: Array<{
    time: Date | string;
    dealId?: string;
    dealNo?: string;
    balanceAfter?: NumericLike;
    balance?: NumericLike;
  }>,
  fallback: NumericLike = 0,
) {
  let last: number | null = null;
  for (const deal of sortDeals(deals as TimedRow[])) {
    const b = getDealBalanceValue(deal as any);
    if (b !== null) last = b;
  }
  return last !== null ? last : Number(fallback ?? 0);
}

function getPricePrecision(value: number | null | undefined) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const normalized = Number(value ?? 0).toString();
  const fractional = normalized.split(".")[1];
  return fractional ? fractional.length : 0;
}

const FX_CODES = new Set([
  "AUD",
  "CAD",
  "CHF",
  "CNH",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "JPY",
  "MXN",
  "NOK",
  "NZD",
  "PLN",
  "SEK",
  "SGD",
  "TRY",
  "USD",
  "ZAR",
]);

export type InstrumentSpec = { pointSize: number; pointsPerPip: number };

const INSTRUMENT_SPECS: Record<string, InstrumentSpec> = {
  // Gold's point (0.01) is the pip itself — no pipette digit like forex has.
  XAUUSD: { pointSize: 0.01, pointsPerPip: 1 },
  BTCUSD: { pointSize: 1, pointsPerPip: 100 },
};

function normalizeSymbol(symbol: string | null | undefined) {
  return (symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function resolveFxPointSize(normalizedSymbol: string) {
  if (normalizedSymbol.length < 6) {
    return null;
  }

  for (let index = 0; index <= normalizedSymbol.length - 6; index += 1) {
    const base = normalizedSymbol.slice(index, index + 3);
    const quote = normalizedSymbol.slice(index + 3, index + 6);
    if (FX_CODES.has(base) && FX_CODES.has(quote)) {
      return quote === "JPY" ? 0.001 : 0.00001;
    }
  }

  return null;
}

export function resolveInstrumentSpec(
  symbol: string | null | undefined,
  openPrice: number | null | undefined,
  closePrice: number | null | undefined,
): InstrumentSpec {
  const normalized = normalizeSymbol(symbol);

  const explicit = INSTRUMENT_SPECS[normalized];
  if (explicit) {
    return explicit;
  }

  const fxPointSize = resolveFxPointSize(normalized);
  if (fxPointSize !== null) {
    return { pointSize: fxPointSize, pointsPerPip: 10 };
  }

  const precision = Math.max(
    getPricePrecision(openPrice),
    getPricePrecision(closePrice),
  );
  const pointSize = precision > 0 ? 10 ** -precision : 1;
  return { pointSize, pointsPerPip: 10 };
}

export function positionPips(position: {
  symbol?: string | null;
  type?: string | null;
  direction?: string | null;
  openPrice?: NumericLike;
  closePrice?: NumericLike;
}) {
  const openPrice = Number(position.openPrice ?? Number.NaN);
  const closePrice = Number(position.closePrice ?? Number.NaN);
  if (!Number.isFinite(openPrice) || !Number.isFinite(closePrice)) {
    return null;
  }

  const side = normalizeTradeSide(
    position.type,
    position.direction ?? position.type,
  );
  if (side !== "buy" && side !== "sell") {
    return null;
  }

  const spec = resolveInstrumentSpec(position.symbol, openPrice, closePrice);
  if (!Number.isFinite(spec.pointSize) || spec.pointSize <= 0) {
    return null;
  }

  const rawPoints =
    side === "buy"
      ? (closePrice - openPrice) / spec.pointSize
      : (openPrice - closePrice) / spec.pointSize;
  const rawPips = rawPoints / spec.pointsPerPip;
  return Number.isFinite(rawPips) ? rawPips : null;
}

export function computeCompoundedGrowth(
  deals: BalanceRow[],
  start: Date | null,
  end: Date | null = null,
) {
  const sorted = sortDeals(deals);
  const startTime = start ? start.getTime() : 0;
  const endTime = end ? end.getTime() : Infinity;

  let balance = 0;
  let periodStartBalance = 0;
  let growthFactor = 1;
  let hasDealsInWindow = false;

  for (const deal of sorted) {
    const ts = parseTimestamp(deal.time);
    if (ts > endTime) break;

    const delta = dealNet(deal);
    const op = classifyBalanceOperation(deal.type, deal.comment, delta);
    const providedBalance = getDealBalanceValue(deal);

    const inWindow = ts >= startTime;
    if (inWindow && !hasDealsInWindow) {
      hasDealsInWindow = true;
      periodStartBalance = balance;
    }

    if (op !== null) {
      if (inWindow && periodStartBalance > 0) {
        growthFactor *= balance / periodStartBalance;
      }
      balance = providedBalance !== null ? providedBalance : balance + delta;
      if (inWindow) periodStartBalance = balance;
    } else {
      balance = providedBalance !== null ? providedBalance : balance + delta;
    }
  }

  if (hasDealsInWindow && periodStartBalance > 0) {
    growthFactor *= balance / periodStartBalance;
  }

  if (!hasDealsInWindow) return 0;

  const growth = (growthFactor - 1) * 100;
  return Number.isFinite(growth) ? growth : 0;
}

export function computeAbsoluteGain(
  deals: BalanceRow[],
  start: Date | null,
  end: Date | null = null,
) {
  const { points, initialDeposit, startBalance, endBalance } = getTradeMetrics(
    deals,
    start,
    end,
  );
  if (!points.length) return 0;
  const profit = computeAbsoluteGainCore(startBalance, endBalance);
  const capitalBase =
    startBalance > 0 ? startBalance : initialDeposit > 0 ? initialDeposit : 0;
  if (capitalBase <= 0) return 0;
  return (profit / capitalBase) * 100;
}

export function computeSharpeRatio(values: number[]) {
  if (values.length < 2) return null;
  const average =
    values.reduce((total, value) => total + value, 0) / values.length;
  const variance =
    values.reduce((total, value) => total + (value - average) ** 2, 0) /
    (values.length - 1);
  const deviation = Math.sqrt(variance);
  if (!Number.isFinite(deviation) || deviation === 0) return null;
  return average / deviation;
}

// Per-trade Sharpe scaled to an annualized number so gauge benchmarks (1/2/3/4)
// remain meaningful regardless of how often the strategy trades. Falls back to
// the per-trade value when the time span cannot be derived.
export function computeAnnualizedSharpeRatio(
  values: number[],
  tradesPerYear: number | null,
) {
  const sharpe = computeSharpeRatio(values);
  if (sharpe === null) return null;
  if (
    !Number.isFinite(tradesPerYear ?? Number.NaN) ||
    (tradesPerYear ?? 0) <= 0
  )
    return sharpe;
  return sharpe * Math.sqrt(tradesPerYear as number);
}

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

export function computeTradesPerYear(
  positions: Array<{
    closeTime?: Date | string | null;
    outTime?: Date | string | null;
  }>,
) {
  const closes = positions
    .map((position) => parseTimestamp(getPositionCloseTime(position)))
    .filter((ts) => Number.isFinite(ts))
    .sort((left, right) => left - right);
  if (closes.length < 2) return null;
  const spanMs = closes[closes.length - 1] - closes[0];
  if (spanMs <= 0) return null;
  return (closes.length / spanMs) * MS_PER_YEAR;
}

type PositionLifetimeRow = {
  openTime?: Date | string | null;
  inTime?: Date | string | null;
  closeTime?: Date | string | null;
  outTime?: Date | string | null;
};

type PositionLifetimeRange = {
  start: number;
  end: number;
};

function getPositionLifetimeRange(
  row: PositionLifetimeRow,
): PositionLifetimeRange | null {
  const opened = parseTimestamp(getPositionOpenTime(row));
  const closed = parseTimestamp(getPositionCloseTime(row));

  if (!Number.isFinite(opened) && !Number.isFinite(closed)) {
    return null;
  }

  if (!Number.isFinite(opened)) {
    return { start: closed, end: closed };
  }

  if (!Number.isFinite(closed)) {
    return { start: opened, end: opened };
  }

  if (closed < opened) {
    return { start: closed, end: closed };
  }

  return { start: opened, end: closed };
}

function getLifetimeCalendarDayCount(start: number, end: number) {
  const startDay = startOfBangkokDay(start);
  const endDay = startOfBangkokDay(end);
  if (!startDay || !endDay) {
    return null;
  }

  return Math.max(
    1,
    Math.floor((endDay.getTime() - startDay.getTime()) / 86_400_000) + 1,
  );
}

function getLifetimeCalendarWindow(
  rows: PositionLifetimeRow[],
  reportTime?: Date | string | null,
) {
  let earliestStart = Number.POSITIVE_INFINITY;
  let latestEnd = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    const range = getPositionLifetimeRange(row);
    if (!range) {
      continue;
    }

    earliestStart = Math.min(earliestStart, range.start);
    latestEnd = Math.max(latestEnd, range.end);
  }

  if (!Number.isFinite(earliestStart) || !Number.isFinite(latestEnd)) {
    return null;
  }

  const reportTimestamp = parseTimestamp(reportTime);
  const windowEnd = Number.isFinite(reportTimestamp)
    ? Math.max(latestEnd, reportTimestamp)
    : latestEnd;
  const totalDays = getLifetimeCalendarDayCount(earliestStart, windowEnd);
  if (!totalDays) {
    return null;
  }

  return {
    totalDays,
  };
}

export function computeTradeActivityPercent(
  rows: PositionLifetimeRow[],
  reportTime?: Date | string | null,
  windowStart?: Date | null,
) {
  let totalDays: number;
  if (windowStart) {
    const reportTimestamp = reportTime ? parseTimestamp(reportTime) : null;
    const windowEnd = Number.isFinite(reportTimestamp as number)
      ? (reportTimestamp as number)
      : Date.now();
    const counted = getLifetimeCalendarDayCount(
      windowStart.getTime(),
      windowEnd,
    );
    if (!counted) return null;
    totalDays = counted;
  } else {
    const lifetimeWindow = getLifetimeCalendarWindow(rows, reportTime ?? null);
    if (!lifetimeWindow) return null;
    totalDays = lifetimeWindow.totalDays;
  }

  const activeDays = new Set<string>();

  for (const row of rows) {
    const range = getPositionLifetimeRange(row);
    if (!range) {
      continue;
    }

    let cursor = startOfBangkokDay(range.start);
    const endDay = startOfBangkokDay(range.end);
    if (!cursor || !endDay) {
      continue;
    }

    while (cursor.getTime() <= endDay.getTime()) {
      const dayKey = getBangkokDateKey(cursor);
      if (dayKey) {
        activeDays.add(dayKey);
      }

      const nextDay = addBangkokDays(cursor, 1);
      if (!nextDay) {
        break;
      }

      cursor = nextDay;
    }
  }

  return (activeDays.size / totalDays) * 100;
}

const RX_MANUAL_COMMENT =
  /^(manual|balance|credit|deposit|withdrawal|correction|rebate)$/i;

export function computeAlgoTradingPercent(
  rows: Array<{ comment?: string | null }>,
) {
  if (rows.length === 0) return null;
  const algoCount = rows.filter((row) => {
    const c = row.comment?.trim();
    if (!c) return false;
    return !RX_MANUAL_COMMENT.test(c);
  }).length;
  return (algoCount / rows.length) * 100;
}

export function computeTradesPerWeek(
  rows: PositionLifetimeRow[],
  reportTime?: Date | string | null,
) {
  const closedCount = rows.reduce(
    (total, row) =>
      Number.isFinite(parseTimestamp(getPositionCloseTime(row)))
        ? total + 1
        : total,
    0,
  );
  if (closedCount === 0) {
    return null;
  }

  const lifetimeWindow = getLifetimeCalendarWindow(rows, reportTime);
  if (!lifetimeWindow) {
    return null;
  }

  return (closedCount / lifetimeWindow.totalDays) * 7;
}

export function computeAverageHoldHours(
  rows: Array<{
    openTime?: Date | string | null;
    inTime?: Date | string | null;
    closeTime?: Date | string | null;
    outTime?: Date | string | null;
  }>,
) {
  let totalHours = 0;
  let count = 0;
  for (const row of rows) {
    const opened = parseTimestamp(getPositionOpenTime(row));
    const closed = parseTimestamp(getPositionCloseTime(row));
    if (Number.isFinite(opened) && Number.isFinite(closed) && closed > opened) {
      totalHours += (closed - opened) / 3_600_000;
      count++;
    }
  }
  return count === 0 ? null : totalHours / count;
}

export function computeConsecutiveRunAmounts(values: number[]) {
  let currentProfit = 0,
    currentLoss = 0,
    maxProfit = 0,
    maxLoss = 0;
  for (const value of values) {
    if (value > 0) {
      currentProfit += value;
      currentLoss = 0;
    } else if (value < 0) {
      currentLoss += Math.abs(value);
      currentProfit = 0;
    } else {
      currentProfit = 0;
      currentLoss = 0;
    }
    if (currentProfit > maxProfit) maxProfit = currentProfit;
    if (currentLoss > maxLoss) maxLoss = currentLoss;
  }
  return {
    maxConsecutiveProfitAmount: maxProfit > 0 ? maxProfit : null,
    maxConsecutiveLossAmount: maxLoss > 0 ? maxLoss : null,
  };
}

export function computeStreaks(values: number[]) {
  let bestWinStreak = 0,
    worstLossStreak = 0,
    currentWins = 0,
    currentLosses = 0;
  for (const value of values) {
    if (value > 0) {
      currentWins++;
      currentLosses = 0;
    } else if (value < 0) {
      currentLosses++;
      currentWins = 0;
    } else {
      currentWins = 0;
      currentLosses = 0;
    }
    if (currentWins > bestWinStreak) bestWinStreak = currentWins;
    if (currentLosses > worstLossStreak) worstLossStreak = currentLosses;
  }
  return { bestWinStreak, worstLossStreak };
}

export function isClosedPosition(row: {
  closeTime?: Date | string | null;
  outTime?: Date | string | null;
}) {
  return Number.isFinite(parseTimestamp(getPositionCloseTime(row)));
}

export function summarizeClosedPositions(rows: PositionMetricRow[]) {
  const closed = rows
    .map((row) => ({ row, ts: parseTimestamp(getPositionCloseTime(row)) }))
    .filter((x) => Number.isFinite(x.ts))
    .sort(
      (a, b) =>
        a.ts - b.ts ||
        getPositionSortKey(a.row).localeCompare(getPositionSortKey(b.row)),
    );

  let totalNetProfit = 0,
    grossProfit = 0,
    grossLoss = 0;
  let profitCount = 0,
    lossCount = 0;
  let maxProfit = -Infinity,
    maxLoss = Infinity;
  let longTotal = 0,
    longWon = 0,
    shortTotal = 0,
    shortWon = 0;
  let currentWins = 0,
    bestWinStreak = 0,
    currentLosses = 0,
    worstLossStreak = 0;
  const netValues: number[] = [];

  for (const { row } of closed) {
    const profit = dealNet(row);
    if (!Number.isFinite(profit)) continue;

    netValues.push(profit);
    totalNetProfit += profit;

    if (profit > 0) {
      grossProfit += profit;
      profitCount++;
      if (profit > maxProfit) maxProfit = profit;
      currentWins++;
      currentLosses = 0;
      if (currentWins > bestWinStreak) bestWinStreak = currentWins;
    } else if (profit < 0) {
      grossLoss += Math.abs(profit);
      lossCount++;
      if (profit < maxLoss) maxLoss = profit;
      currentLosses++;
      currentWins = 0;
      if (currentLosses > worstLossStreak) worstLossStreak = currentLosses;
    } else {
      currentWins = 0;
      currentLosses = 0;
    }

    const side = normalizeTradeSide(row.type, row.direction ?? row.type);
    if (side === "buy") {
      longTotal++;
      if (profit > 0) longWon++;
    } else if (side === "sell") {
      shortTotal++;
      if (profit > 0) shortWon++;
    }
  }

  const totalTrades = netValues.length;

  return {
    netValues,
    totalTrades,
    totalNetProfit,
    winPercent: totalTrades > 0 ? (profitCount / totalTrades) * 100 : null,
    profitTradesCount: profitCount,
    lossTradesCount: lossCount,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    expectedPayoff: totalTrades > 0 ? totalNetProfit / totalTrades : null,
    largestProfitTrade: profitCount > 0 ? maxProfit : null,
    largestLossTrade: lossCount > 0 ? maxLoss : null,
    averageProfitTrade: profitCount > 0 ? grossProfit / profitCount : null,
    averageLossTrade: lossCount > 0 ? grossLoss / lossCount : null,
    longTradesTotal: longTotal,
    longTradesWon: longWon,
    shortTradesTotal: shortTotal,
    shortTradesWon: shortWon,
    maximumConsecutiveWins: totalTrades > 0 ? bestWinStreak : null,
    maximumConsecutiveLosses: totalTrades > 0 ? worstLossStreak : null,
  };
}

export function getTradeWinPercent(
  deals: Array<{
    type?: string | null;
    direction?: string | null;
    symbol?: string | null;
    profit?: NumericLike;
    commission?: NumericLike;
    swap?: NumericLike;
  }>,
) {
  let trades = 0,
    wins = 0;
  for (const d of deals) {
    if (isTradingDeal(d)) {
      trades++;
      if (dealNet(d) > 0) wins++;
    }
  }
  return trades > 0 ? (wins / trades) * 100 : 0;
}

export function getLongTradeWinPercent(
  deals: Array<{
    type?: string | null;
    direction?: string | null;
    symbol?: string | null;
    profit?: NumericLike;
    commission?: NumericLike;
    swap?: NumericLike;
  }>,
) {
  let trades = 0,
    wins = 0;
  for (const d of deals) {
    if (isTradingDeal(d) && normalizeTradeSide(d.type, d.direction) === "buy") {
      trades++;
      if (dealNet(d) > 0) wins++;
    }
  }
  return trades > 0 ? (wins / trades) * 100 : null;
}

export function getShortTradeWinPercent(
  deals: Array<{
    type?: string | null;
    direction?: string | null;
    symbol?: string | null;
    profit?: NumericLike;
    commission?: NumericLike;
    swap?: NumericLike;
  }>,
) {
  let trades = 0,
    wins = 0;
  for (const d of deals) {
    if (
      isTradingDeal(d) &&
      normalizeTradeSide(d.type, d.direction) === "sell"
    ) {
      trades++;
      if (dealNet(d) > 0) wins++;
    }
  }
  return trades > 0 ? (wins / trades) * 100 : null;
}

export function buildDailyProfitSeries(
  deals: BalanceRow[],
  days = 5,
  now = new Date(),
) {
  const end = endOfBangkokDay(now) ?? new Date(now.getTime());
  const dayKeys: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const cursor = addBangkokDays(end, -offset);
    dayKeys.push(getBangkokDateKey(cursor) ?? "-");
  }

  const totals = new Map(dayKeys.map((k) => [k, 0]));
  for (const deal of deals) {
    const delta = dealNet(deal);
    if (!isTradingDeal(deal)) continue;

    const day = toIsoDay(deal.time);
    if (day && totals.has(day)) totals.set(day, totals.get(day)! + delta);
  }
  return dayKeys.map((date) => ({ date, profit: totals.get(date)! }));
}

export function buildFundingTotals(deals: BalanceRow[]) {
  let totalDeposit = 0,
    totalWithdraw = 0;
  for (const deal of deals) {
    const delta = dealNet(deal);
    if (!Number.isFinite(delta) || delta === 0) continue;
    const op = classifyBalanceOperation(deal.type, deal.comment, delta);
    if (op === "deposit" && delta > 0) totalDeposit += delta;
    else if (op === "withdrawal" && delta < 0) totalWithdraw += Math.abs(delta);
  }
  return { totalDeposit, totalWithdraw };
}

export function computeAbsoluteDrawdown(
  initialDeposit: number | null | undefined,
  minimalBalance: number | null | undefined,
) {
  const initial = Number(initialDeposit ?? 0);
  const minimal = Number(minimalBalance ?? 0);
  const value = initial - minimal;

  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function computeDepositLoadPercent(params: {
  equity: number | null | undefined;
  margin: number | null | undefined;
}) {
  const equity = Number(params.equity ?? 0);
  if (!Number.isFinite(equity) || equity <= 0) return null;
  const margin = Math.max(0, Number(params.margin ?? 0));
  const load = (margin / equity) * 100;
  return Number.isFinite(load) ? load : null;
}

export function buildSymbolTradePercent(
  deals: Array<{ symbol?: string | null; type?: string | null }>,
) {
  const counts = new Map<string, number>();
  let total = 0;
  for (const deal of deals) {
    if (!isTradingDeal(deal.type)) continue;
    const symbol = sanitizeOptionalText(deal.symbol) ?? "UNKNOWN";
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    total++;
  }
  if (total === 0) return [];
  return Array.from(counts.entries())
    .map(([symbol, count]) => ({ symbol, percent: (count / total) * 100 }))
    .sort((a, b) => b.percent - a.percent || a.symbol.localeCompare(b.symbol));
}

export function buildBalanceCurve(deals: BalanceRow[]) {
  const sorted = sortDeals(deals);
  let firstKnownIndex = -1;
  let firstKnownBalance = null;
  for (let i = 0; i < sorted.length; i++) {
    const b = getDealBalanceValue(sorted[i]);
    if (b !== null) {
      firstKnownIndex = i;
      firstKnownBalance = b;
      break;
    }
  }

  let runningBalance: number | null = null;
  if (firstKnownIndex !== -1 && firstKnownBalance !== null) {
    let bal = firstKnownBalance;
    for (let i = firstKnownIndex; i > 0; i--) {
      bal -= dealNet(sorted[i]);
    }
    runningBalance = bal;
  }

  const points = [];
  for (const deal of sorted) {
    const b = getDealBalanceValue(deal);
    const delta = dealNet(deal);
    const op = classifyBalanceOperation(deal.type, deal.comment, delta);
    if (b !== null) {
      runningBalance = b;
    } else if (runningBalance !== null) {
      runningBalance += delta;
    } else if (op === "deposit" && delta > 0) {
      runningBalance = delta;
    }
    if (runningBalance !== null && Number.isFinite(runningBalance)) {
      points.push({
        time: deal.time,
        balance: runningBalance,
        eventType: isTradingDeal(deal)
          ? deal.type || "trade"
          : (deal.type ?? null),
        eventDelta: delta,
      });
    }
  }
  return points;
}

export function buildUnitDrawdownCurve(
  deals: BalanceRow[],
  start: Date | null = null,
  end: Date | null = null,
) {
  const { points, startBalance } = getTradeMetrics(deals, start, end);
  let highWaterMark = startBalance;
  return points.map((pt) => {
    highWaterMark = Math.max(highWaterMark, pt.balance);
    return {
      time: new Date(pt.time),
      equity: pt.balance,
      unitValue: pt.balance,
      highWaterMark,
      drawdownPercent:
        highWaterMark > 0
          ? ((highWaterMark - pt.balance) / highWaterMark) * 100
          : 0,
    };
  });
}

// Normalise a BalanceEventPoint curve by stripping external deposits/withdrawals so the chart
// reflects pure trading P&L. When skipSeedDeposit=true (timeframe "all"), the very first
// non-trading event is the initial deposit and must remain as the baseline; all subsequent
// transfers are zeroed out. When skipSeedDeposit=false (filtered windows), every transfer is
// normalised away because the curve already starts at the period-open balance.
export function normalizeExcludeTransfers(
  curve: BalanceEventPoint[],
  skipSeedDeposit: boolean,
): { x: number; balance: number }[] {
  let cumulativeFunding = 0;
  let seedDepositConsumed = !skipSeedDeposit;
  return curve.map((pt) => {
    if (!isTradingDeal(pt.eventType) && pt.eventDelta != null) {
      if (!seedDepositConsumed) {
        seedDepositConsumed = true;
      } else {
        cumulativeFunding += pt.eventDelta;
      }
    }
    return {
      x: new Date(pt.x).getTime(),
      balance: pt.balance - cumulativeFunding,
    };
  });
}

// Compute a drawdown-percent series from an already-normalised {x, balance} curve.
// hwm seeds from the first point so the initial region is not artificially flat.
export function buildDrawdownPercentSeries(
  normalized: { x: number; balance: number }[],
): { x: number; y: number }[] {
  let hwm = normalized[0]?.balance ?? 0;
  return normalized.map((pt) => {
    hwm = Math.max(hwm, pt.balance);
    const dd = hwm > 0 ? ((hwm - pt.balance) / hwm) * 100 : 0;
    return { x: pt.x, y: -dd };
  });
}

export function computeBalanceDrawdown(
  deals: BalanceRow[],
  start: Date | null = null,
  end: Date | null = null,
) {
  const { points, initialDeposit, totalDeposits, startBalance } =
    getTradeMetrics(deals, start, end);
  const absoluteAmount = computeAbsoluteDrawdown(initialDeposit, startBalance);

  if (!points.length) {
    return {
      initialDeposit,
      totalDeposits,
      minimalBalance: startBalance,
      absoluteAmount,
      maximalAmount: 0,
      maximalPercent: 0,
      relativeAmount: 0,
      relativePercent: 0,
      peakBalance: startBalance,
      troughBalance: startBalance,
    };
  }

  let peak = startBalance,
    minimal = startBalance;
  let peakBal = startBalance,
    troughBal = startBalance;
  let maxAmt = 0,
    maxPct = 0,
    relAmt = 0,
    relPct = 0;

  for (const pt of points) {
    minimal = Math.min(minimal, pt.balance);
    peak = Math.max(peak, pt.balance);
    const ddAmt = peak - pt.balance;
    const ddPct = peak > 0 ? (ddAmt / peak) * 100 : 0;

    if (ddAmt > maxAmt || (ddAmt === maxAmt && ddPct > maxPct)) {
      maxAmt = ddAmt;
      maxPct = ddPct;
      peakBal = peak;
      troughBal = pt.balance;
    }
    if (ddPct > relPct || (ddPct === relPct && ddAmt > relAmt)) {
      relAmt = ddAmt;
      relPct = ddPct;
    }
  }

  return {
    initialDeposit,
    totalDeposits,
    minimalBalance: minimal,
    absoluteAmount: computeAbsoluteDrawdown(initialDeposit, minimal),
    maximalAmount: maxAmt,
    maximalPercent: maxPct,
    relativeAmount: relAmt,
    relativePercent: relPct,
    peakBalance: peakBal,
    troughBalance: troughBal,
  };
}

export function computeAllTimeGrowth(deals: BalanceRow[]) {
  return computeCompoundedGrowth(deals, null, null);
}

export function computeYearGrowth(deals: BalanceRow[], year: number) {
  return computeCompoundedGrowth(
    deals,
    new Date(year, 0, 1, 0, 0, 0, 0),
    new Date(year, 11, 31, 23, 59, 59, 999),
  );
}

export function summarizeTrades(deals: BalanceRow[]) {
  let trades = 0,
    wins = 0,
    netProfit = 0;
  for (const d of deals) {
    if (isTradingDeal(d)) {
      trades++;
      const net = dealNet(d);
      if (net > 0) wins++;
      netProfit += net;
    }
  }
  return {
    trades,
    winPercent: trades > 0 ? (wins / trades) * 100 : 0,
    netProfit,
  };
}
