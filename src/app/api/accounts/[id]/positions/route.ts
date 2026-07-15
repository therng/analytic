import { NextRequest, NextResponse } from "next/server";

import {
  type AccountRouteContext,
  withCachedAccountView,
} from "@/app/api/accounts/[id]/route-helpers";
import {
  paginatePositionsResponse,
  parsePositionHistoryPageOptions,
} from "@/lib/trading/preaggregated-cache";
import type { PositionsResponse } from "@/lib/trading/types";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: AccountRouteContext,
) {
  const { id } = await params;
  const historyOptions = parsePositionHistoryPageOptions(
    request.nextUrl.searchParams,
  );

  return withCachedAccountView(
    request,
    id,
    "positions",
    "Failed to fetch account position details",
    (payload) =>
      NextResponse.json(
        paginatePositionsResponse(payload as PositionsResponse, historyOptions),
      ),
  );
}
