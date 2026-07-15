import { NextResponse } from "next/server";

import { getDatabaseErrorDetails } from "@/lib/database-errors";
import { getAccountListItems } from "@/lib/trading/account-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const accounts = await getAccountListItems();
    const response = NextResponse.json(accounts);
    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    return response;
  } catch (error) {
    console.error("API Error:", error);
    const details = getDatabaseErrorDetails(error, "Failed to fetch accounts");
    return NextResponse.json(
      { error: details.message },
      { status: details.status },
    );
  }
}
