import { type NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getMt5LiveData } from "@/lib/redis-mt5";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const DEFAULT_LIVE_POSITION_LIMIT = 100;

function parseLivePositionLimit(request: NextRequest) {
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? DEFAULT_LIVE_POSITION_LIMIT);
  return Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIVE_POSITION_LIMIT;
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  try {
    const account = await prisma.tradingAccount.findUnique({
      where: { id },
      select: { accountNo: true },
    });

    if (!account) {
      return NextResponse.json(
        { live: null, positions: [], stale: true, error: "account not found" },
        { status: 404 },
      );
    }

    const data = await getMt5LiveData(account.accountNo, {
      positionLimit: parseLivePositionLimit(request),
    });
    const response = NextResponse.json(data);
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return response;
  } catch (error) {
    console.error(`[live] Redis error for account ${id}:`, error);
    return NextResponse.json(
      { live: null, positions: [], stale: true, error: "bridge unavailable" },
      { status: 503 },
    );
  }
}
