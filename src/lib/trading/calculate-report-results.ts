import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  computeAHPR,
  computeAverageStreaks,
  computeBalanceDrawdown,
  computeConsecutiveRunAmounts,
  computeGHPR,
  computeHoldingPeriodReturns,
  computeSharpeRatio,
  computeZScore,
  buildBalanceCurve,
  summarizeClosedPositions,
  summarizeHoldingTime,
} from "@/lib/trading/analytics";
import {
  buildTradeDistributionDetail,
  computeLinearRegression,
} from "@/lib/trading/trade-distributions";

type NumericLike = number | Prisma.Decimal | null | undefined;

type PositionLike = {
  positionNo?: string | null;
  symbol?: string | null;
  openTime?: Date | string | null;
  closeTime?: Date | string | null;
  type?: string | null;
  direction?: string | null;
  profit?: NumericLike;
  commission?: NumericLike;
  swap?: NumericLike;
  mae?: NumericLike;
  mfe?: NumericLike;
};

type DealLike = {
  dealNo?: string;
  time: Date | string;
  type?: string | null;
  comment?: string | null;
  profit?: NumericLike;
  commission?: NumericLike;
  swap?: NumericLike;
  balance?: NumericLike;
};

const prismaClient = prisma as any;
const DECIMAL_28_8_MAX_ABS = 1e20;

function toNumber(value: NumericLike) {
  const numeric = Number(value ?? Number.NaN);
  return Number.isFinite(numeric) ? numeric : null;
}

function toFiniteFloatOrNull(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function toDecimalOrNull(value: number | null, fieldName: string) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  if (Math.abs(value) >= DECIMAL_28_8_MAX_ABS) {
    console.warn(
      `Skipping account report metric ${fieldName}: ${value} exceeds DECIMAL(28,8) range.`,
    );
    return null;
  }

  return new Prisma.Decimal(value);
}

function sumNumbers(values: Array<number | null>) {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

export function calculateReportResults(params: {
  positions: PositionLike[];
  deals: DealLike[];
}) {
  const { positions, deals } = params;
  const positionSummary = summarizeClosedPositions(positions);
  const totalCommission = sumNumbers(
    deals.map((deal) => toNumber(deal.commission)),
  );
  const totalSwap = sumNumbers(deals.map((deal) => toNumber(deal.swap)));
  const drawdown = computeBalanceDrawdown(deals);
  const sharpeRatio = computeSharpeRatio(positionSummary.netValues);

  const holdingTime = summarizeHoldingTime(positions);
  const zScore = computeZScore(positionSummary.netValues);
  const consecutiveRunAmounts = computeConsecutiveRunAmounts(
    positionSummary.netValues,
  );
  const averageStreaks = computeAverageStreaks(positionSummary.netValues);
  const tradeDistribution = buildTradeDistributionDetail(positions);
  const correlationProfitMfe = tradeDistribution.available
    ? (tradeDistribution.regressions.mfeProfit?.correlation ?? null)
    : null;
  const correlationProfitMae = tradeDistribution.available
    ? (tradeDistribution.regressions.maeProfit?.correlation ?? null)
    : null;
  const correlationMfeMae = tradeDistribution.available
    ? (tradeDistribution.regressions.mfeMae?.correlation ?? null)
    : null;

  const balanceCurve = buildBalanceCurve(deals);
  const holdingPeriodReturns = computeHoldingPeriodReturns(balanceCurve);
  const ahpr = computeAHPR(holdingPeriodReturns);
  const ghpr = computeGHPR(holdingPeriodReturns);
  const lrRegression = computeLinearRegression(
    balanceCurve.map((point, index) => ({ x: index, y: point.balance })),
  );

  return {
    totalCommission: toDecimalOrNull(totalCommission, "totalCommission"),
    totalSwap: toDecimalOrNull(totalSwap, "totalSwap"),
    totalNetProfit: toDecimalOrNull(
      positionSummary.totalNetProfit,
      "totalNetProfit",
    ),
    grossProfit: toDecimalOrNull(positionSummary.grossProfit, "grossProfit"),
    grossLoss: toDecimalOrNull(positionSummary.grossLoss, "grossLoss"),
    profitFactor: toFiniteFloatOrNull(positionSummary.profitFactor),
    expectedPayoff: toDecimalOrNull(
      positionSummary.expectedPayoff,
      "expectedPayoff",
    ),
    recoveryFactor: toFiniteFloatOrNull(
      Number(drawdown.maximalAmount ?? 0) > 0
        ? positionSummary.totalNetProfit / Number(drawdown.maximalAmount)
        : null,
    ),
    sharpeRatio: toFiniteFloatOrNull(sharpeRatio),
    balanceDrawdownAbsolute: toDecimalOrNull(
      drawdown.absoluteAmount,
      "balanceDrawdownAbsolute",
    ),
    balanceDrawdownMaximal: toDecimalOrNull(
      drawdown.maximalAmount,
      "balanceDrawdownMaximal",
    ),
    balanceDrawdownMaximalPct: toFiniteFloatOrNull(drawdown.maximalPercent),
    balanceDrawdownRelativePct: toFiniteFloatOrNull(drawdown.relativePercent),
    balanceDrawdownRelative: toDecimalOrNull(
      drawdown.relativeAmount,
      "balanceDrawdownRelative",
    ),
    totalTrades: positionSummary.totalTrades,
    shortTradesWon: positionSummary.shortTradesWon,
    shortTradesTotal: positionSummary.shortTradesTotal,
    longTradesWon: positionSummary.longTradesWon,
    longTradesTotal: positionSummary.longTradesTotal,
    profitTradesCount: positionSummary.profitTradesCount,
    lossTradesCount: positionSummary.lossTradesCount,
    largestProfitTrade: toDecimalOrNull(
      positionSummary.largestProfitTrade,
      "largestProfitTrade",
    ),
    largestLossTrade: toDecimalOrNull(
      positionSummary.largestLossTrade,
      "largestLossTrade",
    ),
    averageProfitTrade: toDecimalOrNull(
      positionSummary.averageProfitTrade,
      "averageProfitTrade",
    ),
    averageLossTrade: toDecimalOrNull(
      positionSummary.averageLossTrade,
      "averageLossTrade",
    ),
    maximumConsecutiveWins: positionSummary.maximumConsecutiveWins,
    maximumConsecutiveLosses: positionSummary.maximumConsecutiveLosses,
    maxConsecutiveProfitAmount: toDecimalOrNull(
      consecutiveRunAmounts.maxConsecutiveProfitAmount,
      "maxConsecutiveProfitAmount",
    ),
    maxConsecutiveLossAmount: toDecimalOrNull(
      consecutiveRunAmounts.maxConsecutiveLossAmount,
      "maxConsecutiveLossAmount",
    ),
    averageConsecutiveWins: toFiniteFloatOrNull(averageStreaks.averageWins),
    averageConsecutiveLosses: toFiniteFloatOrNull(
      averageStreaks.averageLosses,
    ),
    ahpr: toFiniteFloatOrNull(ahpr),
    ghpr: toFiniteFloatOrNull(ghpr),
    zScore: toFiniteFloatOrNull(zScore),
    lrCorrelation: toFiniteFloatOrNull(lrRegression?.correlation ?? null),
    lrStandardError: toFiniteFloatOrNull(
      lrRegression?.residualStandardError ?? null,
    ),
    correlationProfitMfe: toFiniteFloatOrNull(correlationProfitMfe),
    correlationProfitMae: toFiniteFloatOrNull(correlationProfitMae),
    correlationMfeMae: toFiniteFloatOrNull(correlationMfeMae),
    minHoldingSeconds: toFiniteFloatOrNull(holdingTime.minHoldingSeconds),
    maxHoldingSeconds: toFiniteFloatOrNull(holdingTime.maxHoldingSeconds),
    avgHoldingSeconds: toFiniteFloatOrNull(holdingTime.avgHoldingSeconds),
  };
}

export async function recomputeAccountReportResult(
  accountId: string,
  sourceReportDate?: Date | null,
) {
  const [positions, deals] = await Promise.all([
    prismaClient.position.findMany({
      where: { tradingAccountId: accountId },
      select: {
        positionNo: true,
        symbol: true,
        openTime: true,
        closeTime: true,
        type: true,
        commission: true,
        swap: true,
        profit: true,
        mae: true,
        mfe: true,
      },
      orderBy: [{ closeTime: "asc" }, { positionNo: "asc" }],
    }),
    prismaClient.deal.findMany({
      where: { tradingAccountId: accountId },
      select: {
        dealNo: true,
        time: true,
        type: true,
        comment: true,
        profit: true,
        commission: true,
        swap: true,
        balance: true,
      },
      orderBy: [{ time: "asc" }, { dealNo: "asc" }],
    }),
  ]);

  const result = calculateReportResults({ positions, deals });

  await prismaClient.accountReportResult.upsert({
    where: { tradingAccountId: accountId },
    update: {
      ...result,
      computedAt: new Date(),
      sourceReportDate: sourceReportDate ?? null,
    },
    create: {
      tradingAccountId: accountId,
      sourceReportDate: sourceReportDate ?? null,
      ...result,
    },
  });

  return result;
}
