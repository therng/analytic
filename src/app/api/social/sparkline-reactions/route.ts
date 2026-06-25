import { NextResponse } from "next/server";
import { getRedisSocialClient } from "@/lib/redis-social";

const ALLOWED_EMOJIS = new Set(["👍", "🎉", "😱"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function reactionKey(accountId: string, date: string) {
  return `sparkline:reactions:${accountId}:${date}`;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId");
  const date = searchParams.get("date");

  if (!accountId || !date || !DATE_RE.test(date)) {
    return NextResponse.json({ error: "accountId and date (YYYY-MM-DD) required" }, { status: 400 });
  }

  try {
    const redis = await getRedisSocialClient();
    const raw = await redis.hGetAll(reactionKey(accountId, date));
    const counts: Record<string, number> = {};
    for (const [emoji, val] of Object.entries(raw)) {
      const n = parseInt(val, 10);
      if (ALLOWED_EMOJIS.has(emoji) && n > 0) counts[emoji] = n;
    }
    return NextResponse.json({ counts });
  } catch {
    return NextResponse.json({ counts: {} });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { accountId, date, emoji, delta } = body ?? {};

  if (!accountId || !date || !DATE_RE.test(date) || !ALLOWED_EMOJIS.has(emoji)) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const inc = delta === -1 ? -1 : 1;

  try {
    const redis = await getRedisSocialClient();
    const key = reactionKey(accountId, date);
    const newVal = await redis.hIncrBy(key, emoji, inc);
    // Clamp to 0 (prevent negative counts from dedup race)
    if (newVal < 0) await redis.hSet(key, emoji, 0);
    // TTL: keep reactions for 30 days
    await redis.expire(key, 60 * 60 * 24 * 30);
    return NextResponse.json({ count: Math.max(0, newVal) });
  } catch {
    return NextResponse.json({ error: "redis unavailable" }, { status: 503 });
  }
}
