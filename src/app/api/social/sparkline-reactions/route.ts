import { NextResponse } from "next/server";
import { getRedisSocialClient } from "@/lib/redis-social";
import {
  SPARKLINE_EMOJIS,
  SPARKLINE_TTL,
  DATE_RE,
  keys,
  getOrCreateSid,
  setSidCookie,
} from "@/lib/social";

// Lua: atomic add-vote. Returns [added(0|1), newCount].
const SCRIPT_ADD = `
  local added = redis.call('sadd', KEYS[1], ARGV[1])
  if added == 0 then
    return {0, tonumber(redis.call('hget', KEYS[2], ARGV[2]) or '0')}
  end
  redis.call('expire', KEYS[1], tonumber(ARGV[3]))
  local nc = redis.call('hincrby', KEYS[2], ARGV[2], 1)
  redis.call('expire', KEYS[2], tonumber(ARGV[3]))
  return {1, nc}
`;

// Lua: atomic remove-vote. Returns [removed(0|1), newCount].
const SCRIPT_REMOVE = `
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

    const voted: string[] = [];
    if (!isNew) {
      const checks = await Promise.all(
        [...SPARKLINE_EMOJIS].map((e) =>
          redis.sIsMember(keys.voters(accountId, date, e), sid).then((yes) => (yes ? e : null))
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

    // 5-second cooldown per session/account/emoji
    const cdKey = keys.cooldown(sid, accountId, emoji);
    if (await redis.exists(cdKey)) {
      return NextResponse.json({ error: "cooldown active" }, { status: 429 });
    }
    await redis.setEx(cdKey, 5, "1");

    // Derive toggle direction server-side — no client delta needed
    const vKey = keys.voters(accountId, date, emoji);
    const cKey = keys.reactions(accountId, date);
    const alreadyVoted = await redis.sIsMember(vKey, sid);

    const script = alreadyVoted ? SCRIPT_REMOVE : SCRIPT_ADD;
    const [, newCount] = (await redis.eval(script, {
      keys: [vKey, cKey],
      arguments: [sid, emoji, SPARKLINE_TTL.toString()],
    })) as [number, number];

    const res = NextResponse.json({ count: Math.max(0, newCount), voted: !alreadyVoted });
    if (isNew) setSidCookie(res, sid);
    return res;
  } catch {
    return NextResponse.json({ error: "redis unavailable" }, { status: 503 });
  }
}
