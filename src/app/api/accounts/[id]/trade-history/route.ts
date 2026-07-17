import { NextRequest, NextResponse } from "next/server";

import {
  type AccountRouteContext,
  jsonApiError,
  withApiErrorHandling,
} from "@/app/api/accounts/[id]/route-helpers";
import { resolveTradingAccount } from "@/lib/trading/account-resolver";
import {
  decodeTradeHistoryCursor,
  parseTradeHistoryPageOptions,
  queryTradeHistoryPage,
} from "@/lib/trading/trade-history";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: AccountRouteContext,
) {
  const { id } = await params;

  return withApiErrorHandling(
    "Failed to fetch account trade history",
    async () => {
      const resolved = await resolveTradingAccount(id);
      if (!resolved) {
        return jsonApiError("Account not found", 404);
      }

      const searchParams = request.nextUrl.searchParams;
      const options = parseTradeHistoryPageOptions(searchParams);

      if (options.cursor !== null && decodeTradeHistoryCursor(options.cursor) === null) {
        return jsonApiError("Invalid cursor", 400);
      }

      const page = await queryTradeHistoryPage(resolved.id, options);
      return NextResponse.json(page);
    },
  );
}
