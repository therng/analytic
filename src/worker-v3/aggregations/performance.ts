// Trading performance metrics (spec §7). Pure exact-decimal functions computed
// from CANONICAL closed trades — never from raw deal/order counts (spec §7.10,
// §28). All money is Prisma.Decimal; ratios that are undefined return null
// rather than NaN/Infinity (spec §7.5, §7.6, §7.11, §7.12). No internal
// rounding — presentation rounds at the API layer.
import { Prisma } from "@prisma/client";

const D = (v: Prisma.Decimal.Value): Prisma.Decimal => new Prisma.Decimal(v);
const ZERO = D(0);
const HUNDRED = D(100);

/** A canonical fully-closed trade. `side` is the original entry direction. */
export interface CanonicalTrade {
  positionId: string;
  side: "buy" | "sell"; // buy = long, sell = short
  netPl: Prisma.Decimal;
  exitTime: Date;
  /** Tie-break for deterministic ordering after exitTime (spec §7.19). */
  exitTimeMs?: number;
}

export interface ConsecutiveSpan {
  count: number;
  total: Prisma.Decimal;
  firstPositionId: string;
  lastPositionId: string;
  startTime: Date;
  endTime: Date;
}

export interface PerformanceSummary {
  totalTrades: number;
  grossProfit: Prisma.Decimal;
  grossLoss: Prisma.Decimal; // signed negative
  totalNetProfit: Prisma.Decimal;
  profitFactor: Prisma.Decimal | null;
  expectedPayoff: Prisma.Decimal | null;

  profitTrades: number;
  lossTrades: number;
  breakevenTrades: number;
  profitTradesPercent: Prisma.Decimal | null;
  lossTradesPercent: Prisma.Decimal | null;

  longTrades: number;
  longWonTrades: number;
  longWinPercent: Prisma.Decimal | null;
  shortTrades: number;
  shortWonTrades: number;
  shortWinPercent: Prisma.Decimal | null;

  largestProfitTrade: Prisma.Decimal | null;
  largestProfitTradeId: string | null;
  largestLossTrade: Prisma.Decimal | null; // signed negative
  largestLossTradeId: string | null;
  averageProfitTrade: Prisma.Decimal | null;
  averageLossTrade: Prisma.Decimal | null; // signed negative

  maxConsecutiveWins: ConsecutiveSpan | null;
  maxConsecutiveLosses: ConsecutiveSpan | null; // total signed negative
  maximalConsecutiveProfit: ConsecutiveSpan | null;
  maximalConsecutiveLoss: ConsecutiveSpan | null; // total signed negative
  averageConsecutiveWins: Prisma.Decimal | null;
  averageConsecutiveLosses: Prisma.Decimal | null;
}

function sortTrades(trades: CanonicalTrade[]): CanonicalTrade[] {
  return [...trades].sort((a, b) => {
    const at = a.exitTime.getTime();
    const bt = b.exitTime.getTime();
    if (at !== bt) return at - bt;
    const ams = a.exitTimeMs ?? 0;
    const bms = b.exitTimeMs ?? 0;
    if (ams !== bms) return ams - bms;
    return a.positionId < b.positionId
      ? -1
      : a.positionId > b.positionId
        ? 1
        : 0;
  });
}

type Klass = "win" | "loss" | "breakeven";
function classify(t: CanonicalTrade): Klass {
  if (t.netPl.greaterThan(ZERO)) return "win";
  if (t.netPl.lessThan(ZERO)) return "loss";
  return "breakeven"; // exactly zero is breakeven, never silently a win (spec §7.14)
}

function spanOf(run: CanonicalTrade[]): ConsecutiveSpan {
  const total = run.reduce((acc, t) => acc.plus(t.netPl), ZERO);
  return {
    count: run.length,
    total,
    firstPositionId: run[0].positionId,
    lastPositionId: run[run.length - 1].positionId,
    startTime: run[0].exitTime,
    endTime: run[run.length - 1].exitTime,
  };
}

/**
 * Split ordered trades into maximal same-class runs of the requested class.
 * A breakeven trade terminates any run (spec §7.19).
 */
function runsOfClass(
  ordered: CanonicalTrade[],
  klass: "win" | "loss",
): ConsecutiveSpan[] {
  const spans: ConsecutiveSpan[] = [];
  let current: CanonicalTrade[] = [];
  for (const t of ordered) {
    if (classify(t) === klass) {
      current.push(t);
    } else if (current.length > 0) {
      spans.push(spanOf(current));
      current = [];
    }
  }
  if (current.length > 0) spans.push(spanOf(current));
  return spans;
}

export function computePerformance(
  trades: CanonicalTrade[],
): PerformanceSummary {
  const ordered = sortTrades(trades);
  const totalTrades = ordered.length;

  let grossProfit = ZERO;
  let grossLoss = ZERO; // accumulates signed-negative netPl
  let profitTrades = 0;
  let lossTrades = 0;
  let breakevenTrades = 0;
  let longTrades = 0;
  let longWonTrades = 0;
  let shortTrades = 0;
  let shortWonTrades = 0;
  let largestProfitTrade: Prisma.Decimal | null = null;
  let largestProfitTradeId: string | null = null;
  let largestLossTrade: Prisma.Decimal | null = null;
  let largestLossTradeId: string | null = null;

  for (const t of ordered) {
    const k = classify(t);
    if (k === "win") {
      grossProfit = grossProfit.plus(t.netPl);
      profitTrades += 1;
      if (
        largestProfitTrade === null ||
        t.netPl.greaterThan(largestProfitTrade)
      ) {
        largestProfitTrade = t.netPl;
        largestProfitTradeId = t.positionId;
      }
    } else if (k === "loss") {
      grossLoss = grossLoss.plus(t.netPl);
      lossTrades += 1;
      if (largestLossTrade === null || t.netPl.lessThan(largestLossTrade)) {
        largestLossTrade = t.netPl;
        largestLossTradeId = t.positionId;
      }
    } else {
      breakevenTrades += 1;
    }

    const isWin = k === "win";
    if (t.side === "buy") {
      longTrades += 1;
      if (isWin) longWonTrades += 1;
    } else {
      shortTrades += 1;
      if (isWin) shortWonTrades += 1;
    }
  }

  const totalNetProfit = grossProfit.plus(grossLoss);
  const grossLossAbs = grossLoss.abs();

  // §7.5 profit factor: null when gross loss is zero (both-zero or divide-by-zero).
  const profitFactor = grossLossAbs.isZero()
    ? null
    : grossProfit.dividedBy(grossLossAbs);
  // §7.6 expected payoff: null when there are no trades.
  const expectedPayoff =
    totalTrades === 0 ? null : totalNetProfit.dividedBy(D(totalTrades));

  const pct = (num: number, den: number): Prisma.Decimal | null =>
    den === 0 ? null : D(num).dividedBy(D(den)).times(HUNDRED);

  const winSpans = runsOfClass(ordered, "win");
  const lossSpans = runsOfClass(ordered, "loss");

  const byCount = (
    spans: ConsecutiveSpan[],
    cmp: (a: ConsecutiveSpan, b: ConsecutiveSpan) => boolean,
  ) =>
    spans.length === 0
      ? null
      : spans.reduce((best, s) => (cmp(s, best) ? s : best));

  const maxConsecutiveWins = byCount(
    winSpans,
    (s, best) => s.count > best.count,
  );
  const maxConsecutiveLosses = byCount(
    lossSpans,
    (s, best) => s.count > best.count,
  );
  const maximalConsecutiveProfit = byCount(winSpans, (s, best) =>
    s.total.greaterThan(best.total),
  );
  const maximalConsecutiveLoss = byCount(lossSpans, (s, best) =>
    s.total.lessThan(best.total),
  );

  const avgConsec = (spans: ConsecutiveSpan[]): Prisma.Decimal | null => {
    if (spans.length === 0) return null;
    const totalTradesInSpans = spans.reduce((acc, s) => acc + s.count, 0);
    return D(totalTradesInSpans).dividedBy(D(spans.length));
  };

  return {
    totalTrades,
    grossProfit,
    grossLoss,
    totalNetProfit,
    profitFactor,
    expectedPayoff,
    profitTrades,
    lossTrades,
    breakevenTrades,
    profitTradesPercent: pct(profitTrades, totalTrades),
    lossTradesPercent: pct(lossTrades, totalTrades),
    longTrades,
    longWonTrades,
    longWinPercent: pct(longWonTrades, longTrades),
    shortTrades,
    shortWonTrades,
    shortWinPercent: pct(shortWonTrades, shortTrades),
    largestProfitTrade,
    largestProfitTradeId,
    largestLossTrade,
    largestLossTradeId,
    averageProfitTrade:
      profitTrades === 0 ? null : grossProfit.dividedBy(D(profitTrades)),
    averageLossTrade:
      lossTrades === 0 ? null : grossLoss.dividedBy(D(lossTrades)),
    maxConsecutiveWins,
    maxConsecutiveLosses,
    maximalConsecutiveProfit,
    maximalConsecutiveLoss,
    averageConsecutiveWins: avgConsec(winSpans),
    averageConsecutiveLosses: avgConsec(lossSpans),
  };
}
