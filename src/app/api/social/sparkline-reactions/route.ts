import { NextResponse } from "next/server";
import { getRedisSocialClient } from "@/lib/redis-social";
import {
  SPARKLINE_EMOJIS,
  SPARKLINE_TTL,
  HOURLY_VOTE_TTL,
  DATE_RE,
  keys,
  getOrCreateSid,
  setSidCookie,
} from "@/lib/social";

// Lua: atomic hourly-limited +1 vote.
// KEYS[1] = hourly rate limit key, KEYS[2] = count hash key
// ARGV[1] = emoji field, ARGV[2] = hourly TTL, ARGV[3] = count hash TTL
// Returns [added(0|1), newCount]
const SCRIPT_VOTE = `
  if redis.call('exists', KEYS[1]) == 1 then
    return {0, tonumber(redis.call('hget', KEYS[2], ARGV[1]) or '0')}
  end
  redis.call('setex', KEYS[1], tonumber(ARGV[2]), '1')
  local nc = redis.call('hincrby', KEYS[2], ARGV[1], 1)
  redis.call('expire', KEYS[2], tonumber(ARGV[3]))
  return {1, nc}
`;

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
    const raw = await redis.hGetAll(keys.reactions(accountId, date));
    const counts: Record<string, number> = {};
    for (const [emoji, val] of Object.entries(raw)) {
      const n = parseInt(val, 10);
      if (SPARKLINE_EMOJIS.has(emoji) && n > 0) counts[emoji] = n;
    }

    // "voted" = session has an active hourly limit for this emoji (voted within last hour)
    const voted: string[] = [];
    if (!isNew) {
      const checks = await Promise.all(
        [...SPARKLINE_EMOJIS].map((e) =>
          redis.exists(keys.hourlyLimit(sid, accountId, e)).then((exists) => (exists ? e : null))
        )
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
  if (!body) return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  const { accountId, date, emoji } = body as Record<string, unknown>;

  if (
    typeof accountId !== "string" ||
    typeof date !== "string" ||
    typeof emoji !== "string" ||
    !DATE_RE.test(date) ||
    !SPARKLINE_EMOJIS.has(emoji)
  ) {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });
  }

  const { sid, isNew } = await getOrCreateSid();

  try {
    const redis = await getRedisSocialClient();

    const hKey = keys.hourlyLimit(sid, accountId, emoji);
    const cKey = keys.reactions(accountId, date);

    const [added, newCount] = (await redis.eval(SCRIPT_VOTE, {
      keys: [hKey, cKey],
      arguments: [emoji, HOURLY_VOTE_TTL.toString(), SPARKLINE_TTL.toString()],
    })) as [number, number];

    if (added === 0) {
      const res = NextResponse.json({ error: "hourly limit reached", voted: true }, { status: 429 });
      if (isNew) setSidCookie(res, sid);
      return res;
    }

    const res = NextResponse.json({ count: Math.max(0, newCount), voted: true });
    if (isNew) setSidCookie(res, sid);
    return res;
  } catch {
    return NextResponse.json({ error: "redis unavailable" }, { status: 503 });
  }
}
