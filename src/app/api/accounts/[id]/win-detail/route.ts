import { NextRequest, NextResponse } from "next/server";

import {
  type AccountRouteContext,
  withCachedAccountView,
} from "@/app/api/accounts/[id]/route-helpers";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: AccountRouteContext,
) {
  const { id } = await params;

  return withCachedAccountView(
    request,
    id,
    "winDetail",
    "Failed to fetch account win details",
    (payload) => NextResponse.json(payload),
  );
}
