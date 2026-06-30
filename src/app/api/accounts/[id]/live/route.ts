import { type NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getMt5LiveData } from "@/lib/redis-mt5";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
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

    const data = await getMt5LiveData(account.accountNo);
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
