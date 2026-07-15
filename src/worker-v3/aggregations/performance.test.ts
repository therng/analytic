import { test } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { computePerformance, type CanonicalTrade } from "./performance";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

let seq = 0;
function trade(side: "buy" | "sell", netPl: number): CanonicalTrade {
  seq += 1;
  return {
    positionId: `p${seq}`,
    side,
    netPl: D(netPl),
    exitTime: new Date(seq * 1000),
  };
}

test("spec §7 performance metrics over a mixed canonical-trade sequence", () => {
  seq = 0;
  const trades: CanonicalTrade[] = [
    trade("buy", 100), // p1 long win
    trade("buy", -40), // p2 long loss
    trade("sell", 60), // p3 short win
    trade("sell", -30), // p4 short loss
    trade("buy", 0), // p5 breakeven (terminates runs, not a win)
    trade("buy", 10), // p6 win
    trade("buy", 10), // p7 win
    trade("buy", 10), // p8 win  -> 3-win run, total 30
    trade("sell", 0), // p9 breakeven
    trade("buy", 50), // p10 win -> 1-win run, total 50
  ];
  const r = computePerformance(trades);

  assert.equal(r.totalTrades, 10);
  assert.ok(r.grossProfit.equals(D(240)), `grossProfit=${r.grossProfit}`);
  assert.ok(r.grossLoss.equals(D(-70)), `grossLoss=${r.grossLoss}`); // signed negative
  assert.ok(r.totalNetProfit.equals(D(170)));
  assert.ok(
    r.profitFactor!.equals(D(240).dividedBy(70)),
    `profitFactor=${r.profitFactor}`,
  );
  assert.ok(r.expectedPayoff!.equals(D(17)));

  assert.equal(r.profitTrades, 6);
  assert.equal(r.lossTrades, 2);
  assert.equal(r.breakevenTrades, 2); // zeros are breakeven, never wins (§7.14)
  assert.ok(r.profitTradesPercent!.equals(D(60)));
  assert.ok(r.lossTradesPercent!.equals(D(20)));

  assert.equal(r.longTrades, 7);
  assert.equal(r.longWonTrades, 5);
  assert.ok(r.longWinPercent!.equals(D(5).dividedBy(7).times(100)));
  assert.equal(r.shortTrades, 3);
  assert.equal(r.shortWonTrades, 1);
  assert.ok(r.shortWinPercent!.equals(D(1).dividedBy(3).times(100)));

  assert.ok(r.largestProfitTrade!.equals(D(100)));
  assert.equal(r.largestProfitTradeId, "p1");
  assert.ok(r.largestLossTrade!.equals(D(-40))); // signed negative
  assert.equal(r.largestLossTradeId, "p2");
  assert.ok(r.averageProfitTrade!.equals(D(40)));
  assert.ok(r.averageLossTrade!.equals(D(-35))); // signed negative

  // §7.19 vs §7.21: longest win run (count 3, total 30) is NOT the greatest-total
  // win run (count 1, total 100). They must be distinct spans.
  assert.equal(r.maxConsecutiveWins!.count, 3);
  assert.ok(r.maxConsecutiveWins!.total.equals(D(30)));
  assert.equal(r.maximalConsecutiveProfit!.count, 1);
  assert.ok(r.maximalConsecutiveProfit!.total.equals(D(100)));

  assert.equal(r.maxConsecutiveLosses!.count, 1);
  assert.ok(r.maxConsecutiveLosses!.total.equals(D(-40)));
  assert.ok(r.maximalConsecutiveLoss!.total.equals(D(-40)));

  // averageConsecutiveWins = (1+1+3+1)/4 = 1.5 ; losses = (1+1)/2 = 1
  assert.ok(r.averageConsecutiveWins!.equals(D("1.5")));
  assert.ok(r.averageConsecutiveLosses!.equals(D(1)));
});

test("empty account: all ratios null, sums zero (§7.5, §7.6)", () => {
  const r = computePerformance([]);
  assert.equal(r.totalTrades, 0);
  assert.ok(r.grossProfit.equals(D(0)));
  assert.ok(r.grossLoss.equals(D(0)));
  assert.equal(r.profitFactor, null);
  assert.equal(r.expectedPayoff, null);
  assert.equal(r.longWinPercent, null);
  assert.equal(r.shortWinPercent, null);
  assert.equal(r.averageProfitTrade, null);
  assert.equal(r.maxConsecutiveWins, null);
});

test("zero gross loss yields null profit factor, not infinity (§7.5)", () => {
  seq = 0;
  const r = computePerformance([trade("buy", 10), trade("buy", 20)]);
  assert.ok(r.grossLoss.equals(D(0)));
  assert.equal(r.profitFactor, null);
  assert.ok(r.expectedPayoff!.equals(D(15)));
});
