import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";

// ── Emoji sets ───────────────────────────────────────────────────────────────
// SPARKLINE_EMOJIS must stay in sync with EMOJIS in src/hooks/useSparklineReactions.ts
export const SPARKLINE_EMOJIS = new Set(["👍", "🎉", "🙄", "🤖", "💊"]);
export const REACTION_EMOJIS  = new Set(["🔥", "💎", "🎯", "👏", "😱"]);

// ── Validation ───────────────────────────────────────────────────────────────
export const VALID_TARGET_TYPES = new Set(["ACCOUNT", "SHOUT"]);
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const SID_RE  = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

// ── TTL ──────────────────────────────────────────────────────────────────────
export const SPARKLINE_TTL = 60 * 60 * 24 * 30; // 30 days in seconds

// ── Redis key builders ───────────────────────────────────────────────────────
export const keys = {
  reactions: (accountId: string, date: string) =>
    `sparkline:reactions:${accountId}:${date}`,
  voters: (accountId: string, date: string, emoji: string) =>
    `sparkline:voters:${accountId}:${date}:${emoji}`,
  cooldown: (sid: string, accountId: string, emoji: string) =>
    `sparkline:cooldown:${sid}:${accountId}:${emoji}`,
};

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
