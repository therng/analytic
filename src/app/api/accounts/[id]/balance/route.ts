import { NextRequest, NextResponse } from "next/server";

import {
  type AccountRouteContext,
  withCachedAccountView,
} from "@/app/api/accounts/[id]/route-helpers";
import { getSinceDate } from "@/lib/trading/analytics";
import {
  buildEquityCurveForAccount,
  buildEquityDrawdownSeries,
} from "@/lib/trading/equity-curve";
import { parseRequestTimeframe } from "@/lib/trading/preaggregated-cache";
import type { BalanceDetailResponse } from "@/lib/trading/types";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: AccountRouteContext,
) {
  const { id } = await params;
  // Same parser withCachedAccountView uses internally — must match so
  // "timeframe missing/invalid → defaults to 1d" stays consistent with
  // which cached view actually comes back.
  const timeframe = parseRequestTimeframe(
    request.nextUrl.searchParams.get("timeframe"),
  );

  return withCachedAccountView(
    request,
    id,
    "balanceDetail",
    "Failed to fetch account balance",
    async (payload) => {
      const balanceDetail = payload as BalanceDetailResponse;

      if (timeframe === "1d") {
        try {
          balanceDetail.equityCurve = await buildEquityCurveForAccount(
            id,
            balanceDetail.account.account_number,
            balanceDetail.balanceCurve[0]?.balance ??
              balanceDetail.balanceCurve[0]?.y,
          );
        } catch (error) {
          // Keep the Deal-derived curve already on balanceDetail (built by the
          // cached view via buildRealtime24HourBalanceCurve, same Bangkok-day
          // boundary) instead of discarding it — a working curve beats none.
          console.error(
            `[balance] Failed to build equity curve for account ${id}:`,
            error,
          );
        }
      }

      // True live-equity drawdown (EquitySnapshot-backed, distinct from the
      // Deal-derived balanceCurve/drawdownCurve above) for every timeframe.
      // EquitySnapshot only retains 7 days, so longer windows just return
      // whatever's actually available.
      try {
        const { equityCurve, drawdownPercentCurve } =
          await buildEquityDrawdownSeries(id, getSinceDate(timeframe));
        balanceDetail.equityDrawdownCurve = drawdownPercentCurve;
        if (timeframe !== "1d") {
          balanceDetail.equityCurve = equityCurve;
        }
      } catch (error) {
        console.error(
          `[balance] Failed to build equity drawdown curve for account ${id}:`,
          error,
        );
      }

      return NextResponse.json(balanceDetail);
    },
  );
}
