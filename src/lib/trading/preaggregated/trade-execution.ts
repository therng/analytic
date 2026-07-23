import { getBangkokDateKey, getBangkokHour } from "@/lib/time";
import type { TradeExecutionDistribution } from "@/lib/trading/types";
import { dealNet, isTradingDeal, normalizeTradeSide } from "@/lib/trading/analytics";
import type { DealRow } from "../preaggregated-cache";

const MAX_REPORT_FUTURE_SKEW_MS = 5 * 60 * 1000;

function getValidDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getDealBalancePointValue(deal: DealRow) {
  const value = Number(deal.balanceAfter ?? deal.balance ?? Number.NaN);
  return Number.isFinite(value) ? value : null;
}

export function buildTradeExecutionDistribution(
  deals: DealRow[],
  reportTime: Date,
): TradeExecutionDistribution {
  const reportDate = getBangkokDateKey(reportTime) ?? "0000-00-00";
  const reportTimestamp = reportTime.getTime();
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    totalExecutions: 0,
    buyExecutions: 0,
    sellExecutions: 0,
    totalVolume: 0,
    totalProfit: 0,
  }));
  const seenDealKeys = new Set<string>();
  let totalExecutions = 0;
  let buyExecutions = 0;
  let sellExecutions = 0;
  let excludedOutsideReportDate = 0;
  let excludedFutureSkew = 0;

  for (const deal of deals) {
    if (!isTradingDeal(deal)) {
      continue;
    }

    const parsedTime = getValidDate(deal.time);
    if (!parsedTime) {
      continue;
    }

    const executionDate = getBangkokDateKey(parsedTime);
    if (executionDate !== reportDate) {
      excludedOutsideReportDate += 1;
      continue;
    }

    if (parsedTime.getTime() > reportTimestamp + MAX_REPORT_FUTURE_SKEW_MS) {
      excludedFutureSkew += 1;
      continue;
    }

    const side = normalizeTradeSide(deal.type, deal.direction);
    const dedupeKey = String(
      deal.dealNo ??
        deal.dealId ??
        `${parsedTime.toISOString()}|${side}|${deal.symbol ?? ""}|${Number(deal.price ?? 0)}|${Number(deal.volume ?? 0)}`,
    );
    if (seenDealKeys.has(dedupeKey)) {
      continue;
    }
    seenDealKeys.add(dedupeKey);

    const hour = getBangkokHour(parsedTime) ?? 0;
    const bucket = hourly[hour];
    if (!bucket) {
      continue;
    }

    const volume = Number(deal.volume ?? 0);
    const profit = dealNet(deal);
    bucket.totalExecutions += 1;
    bucket.totalVolume += Number.isFinite(volume) ? volume : 0;
    bucket.totalProfit += Number.isFinite(profit) ? profit : 0;
    totalExecutions += 1;

    if (side === "buy") {
      bucket.buyExecutions += 1;
      buyExecutions += 1;
    } else if (side === "sell") {
      bucket.sellExecutions += 1;
      sellExecutions += 1;
    }
  }

  return {
    reportDate,
    reportTimestamp: reportTime.toISOString(),
    timezoneBasis: "report-local",
    totalExecutions,
    buyExecutions,
    sellExecutions,
    excludedOutsideReportDate,
    excludedFutureSkew,
    hourly,
  };
}
