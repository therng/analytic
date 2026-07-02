import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { SID_RE, SPARKLINE_TTL } from "@/lib/social-shared";

export * from "@/lib/social-shared";

// ── Anonymous session helpers ─────────────────────────────────────────────────
export async function getOrCreateSid(): Promise<{ sid: string; isNew: boolean }> {
  const cookieStore = await cookies();
  const existing = cookieStore.get("sr_sid")?.value;
  if (existing && SID_RE.test(existing)) return { sid: existing, isNew: false };
  return { sid: randomUUID(), isNew: true };
}

export function setSidCookie(res: NextResponse, sid: string): void {
  res.cookies.set("sr_sid", sid, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: SPARKLINE_TTL,
    path: "/",
  });
}
