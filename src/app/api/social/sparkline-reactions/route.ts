import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { getRedisSocialClient } from "@/lib/redis-social";

const ALLOWED_EMOJIS = new Set(["👍", "🎉", "🫣", "💩", "💊"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL = 60 * 60 * 24 * 30; // 30 days

function reactionKey(accountId: string, date: string) {
  return `sparkline:reactions:${accountId}:${date}`;
}

function voterKey(accountId: string, date: string, emoji: string) {
  return `sparkline:voters:${accountId}:${date}:${emoji}`;
}

async function getOrCreateSid(): Promise<{ sid: string; isNew: boolean }> {
  const cookieStore = await cookies();
  const existing = cookieStore.get("sr_sid")?.value;
  if (existing && SID_RE.test(existing)) return { sid: existing, isNew: false };
  return { sid: randomUUID(), isNew: true };
}

function setSidCookie(res: NextResponse, sid: string) {
  res.cookies.set("sr_sid", sid, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: TTL,
    path: "/",
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId");
  const date = searchParams.get("date");

  if (!accountId || !date || !DATE_RE.test(date)) {
    return NextResponse.json({ error: "accountId and date (YYYY-MM-DD) required" }, { status: 400 });
  }

  const { sid, isNew } = await getOrCreateSid();

  try {
    const redis = await getRedisSocialClient();
    const raw = await redis.hGetAll(reactionKey(accountId, date));
    const counts: Record<string, number> = {};
    for (const [emoji, val] of Object.entries(raw)) {
      const n = parseInt(val, 10);
      if (ALLOWED_EMOJIS.has(emoji) && n > 0) counts[emoji] = n;
    }

    // Check which emojis this session has voted for (server-authoritative)
    const voted: string[] = [];
    if (!isNew) {
      const checks = await Promise.all(
        [...ALLOWED_EMOJIS].map((e) => redis.sIsMember(voterKey(accountId, date, e), sid).then((yes) => (yes ? e : null)))
      );
      voted.push(...(checks.filter(Boolean) as string[]));
    }

    const res = NextResponse.json({ counts, voted });
    if (isNew) setSidCookie(res, sid);
    return res;
  } catch {
    const res = NextResponse.json({ counts: {}, voted: [] });
    if (isNew) setSidCookie(res, sid);
    return res;
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { accountId, date, emoji, delta } = body ?? {};

  if (!accountId || !date || !DATE_RE.test(date) || !ALLOWED_EMOJIS.has(emoji)) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const inc = delta === -1 ? -1 : 1;
  const { sid, isNew } = await getOrCreateSid();

  try {
    const redis = await getRedisSocialClient();
    const cooldownKey = `sparkline:cooldown:${sid}:${accountId}:${emoji}`;
    const inCooldown = await redis.exists(cooldownKey);
    if (inCooldown) {
      return NextResponse.json({ error: "cooldown active" }, { status: 429 });
    }
    await redis.setEx(cooldownKey, 5, "1");
    const cKey = reactionKey(accountId, date);
    const vKey = voterKey(accountId, date, emoji);

    let newCount: number;

    if (inc === 1) {
      const script = `
        local vid = redis.call('sadd', KEYS[1], ARGV[1])
        if vid == 0 then
          return {0, tonumber(redis.call('hget', KEYS[2], ARGV[2]) or '0')}
        end
        redis.call('expire', KEYS[1], tonumber(ARGV[3]))
        local nc = redis.call('hincrby', KEYS[2], ARGV[2], 1)
        redis.call('expire', KEYS[2], tonumber(ARGV[3]))
        return {1, nc}
      `;
      const [vid, count] = (await redis.eval(script, {
        keys: [vKey, cKey],
        arguments: [sid, emoji, TTL.toString()],
      })) as [number, number];

      if (vid === 0) {
        const res = NextResponse.json({ count: Math.max(0, count), voted: true });
        if (isNew) setSidCookie(res, sid);
        return res;
      }
      newCount = count;
    } else {
      const script = `
        local removed = redis.call('srem', KEYS[1], ARGV[1])
        if removed == 0 then
          return {0, tonumber(redis.call('hget', KEYS[2], ARGV[2]) or '0')}
        end
        local nc = redis.call('hincrby', KEYS[2], ARGV[2], -1)
        if nc < 0 then
          redis.call('hset', KEYS[2], ARGV[2], 0)
          nc = 0
        end
        redis.call('expire', KEYS[2], tonumber(ARGV[3]))
        return {1, nc}
      `;
      const [removed, count] = (await redis.eval(script, {
        keys: [vKey, cKey],
        arguments: [sid, emoji, TTL.toString()],
      })) as [number, number];

      if (removed === 0) {
        const res = NextResponse.json({ count: Math.max(0, count), voted: false });
        if (isNew) setSidCookie(res, sid);
        return res;
      }
      newCount = count;
    }

    const voted = inc === 1;
    const res = NextResponse.json({ count: Math.max(0, newCount), voted });
    if (isNew) setSidCookie(res, sid);
    return res;
  } catch {
    return NextResponse.json({ error: "redis unavailable" }, { status: 503 });
  }
}
