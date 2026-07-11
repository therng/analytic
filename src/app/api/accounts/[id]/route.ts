import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  type AccountRouteContext,
  jsonApiError,
  withApiErrorHandling,
  withCachedAccountView,
} from "@/app/api/accounts/[id]/route-helpers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: AccountRouteContext) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const groupBy = searchParams.get("groupBy")?.trim().toLowerCase();

  if (groupBy === "symbol" || groupBy === "strategy") {
    return withApiErrorHandling("Failed to perform groupings calculation", async () => {
      const account = await prisma.tradingAccount.findUnique({
        where: { id },
        select: { accountNo: true },
      });

      if (!account) {
        return jsonApiError("Account not found", 404);
      }

      if (groupBy === "symbol") {
        const perf = await prisma.accountPerformanceBySymbol.findMany({
          where: { accountId: id },
          select: { symbol: true, netProfit: true, trades: true, wins: true, totalVolume: true }
        });

        const result = perf.map((p) => ({
          symbol: p.symbol,
          netProfit: Number(p.netProfit),
          trades: p.trades,
          winRate: p.trades > 0 ? Number(((p.wins / p.trades) * 100).toFixed(2)) : 0,
          totalVolume: p.totalVolume,
        }));

        return NextResponse.json(result);
      } else {
        const perf = await prisma.accountPerformanceByStrategy.findMany({
          where: { accountId: id },
          select: { magic: true, netProfit: true, trades: true, wins: true, totalVolume: true }
        });

        // Query strategy master records for names
        const strategies = await prisma.strategy.findMany();
        const strategyMap = new Map(strategies.map((s) => [s.magic, s.name]));

        const result = perf.map((p) => ({
          magic: p.magic,
          name: strategyMap.get(p.magic) || (p.magic === 0 ? "Manual/Unknown" : `Strategy ${p.magic}`),
          netProfit: Number(p.netProfit),
          trades: p.trades,
          winRate: p.trades > 0 ? Number(((p.wins / p.trades) * 100).toFixed(2)) : 0,
          totalVolume: p.totalVolume,
        }));

        return NextResponse.json(result);
      }
    });
  }

  return withCachedAccountView(request, id, "overview", "Failed to fetch account details", (payload) => NextResponse.json(payload));
}
