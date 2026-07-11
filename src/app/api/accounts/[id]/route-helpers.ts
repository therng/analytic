import { NextRequest, NextResponse } from "next/server";

import { getDatabaseErrorDetails } from "@/lib/database-errors";
import {
  getCachedAccountView,
  parseRequestTimeframe,
  type AccountCachedViewKind,
} from "@/lib/trading/preaggregated-cache";

type RouteHandler = () => Promise<NextResponse> | NextResponse;
export type AccountRouteContext = { params: Promise<{ id: string }> };

export function jsonApiError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function withApiErrorHandling(errorMessage: string, handler: RouteHandler) {
  try {
    return await handler();
  } catch (error) {
    console.error("API Error:", error);
    const details = getDatabaseErrorDetails(error, errorMessage);
    return jsonApiError(details.message, details.status);
  }
}

export async function withCachedAccountView(
  request: NextRequest,
  accountId: string,
  viewKind: AccountCachedViewKind,
  errorMessage: string,
  handler: (payload: unknown) => Promise<NextResponse> | NextResponse,
) {
  return withApiErrorHandling(errorMessage, async () => {
    const searchParams = request.nextUrl.searchParams;
    const timeframe = parseRequestTimeframe(searchParams.get("timeframe"));
    const payload = await getCachedAccountView(accountId, timeframe, viewKind);

    if (!payload) {
      return jsonApiError("Account not found", 404);
    }

    return handler(payload);
  });
}
