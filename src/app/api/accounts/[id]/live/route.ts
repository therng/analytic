import { createHash } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

import {
  getMt5LiveData,
  normalizeMt5PositionTimes,
} from "@/lib/redis-mt5";
import { resolveTradingAccount } from "@/lib/trading/account-resolver";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const DEFAULT_LIVE_POSITION_LIMIT = 1000;

function parseLivePositionLimit(request: NextRequest) {
  const rawLimit = Number(
    request.nextUrl.searchParams.get("limit") ?? DEFAULT_LIVE_POSITION_LIMIT,
  );
  return Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIVE_POSITION_LIMIT;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  try {
    const account = await resolveTradingAccount(id);

    if (!account) {
      return NextResponse.json(
        { live: null, positions: [], stale: true, error: "account not found" },
        { status: 404 },
      );
    }

    const data = await getMt5LiveData(account.accountNo, {
      positionLimit: parseLivePositionLimit(request),
    });
    const body = JSON.stringify({
      ...data,
      // Redis contains MetaTrader UTC epochs. The browser formats those
      // instants through the Bangkok display utilities.
      positions: normalizeMt5PositionTimes(
        data.positions,
        account.brokerUtcOffsetMinutes ?? 0,
      ),
    });
    // Conditional-request support: the 2s live poll sends If-None-Match and
    // gets an empty 304 while Redis live state is unchanged, cutting payload
    // transfer + client parse/render work.
    const etag = `"${createHash("sha1").update(body).digest("base64url")}"`;

    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json",
        ETag: etag,
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error(`[live] Redis error for account ${id}:`, error);
    return NextResponse.json(
      { live: null, positions: [], stale: true, error: "bridge unavailable" },
      { status: 503 },
    );
  }
}
