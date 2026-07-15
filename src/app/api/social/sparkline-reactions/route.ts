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

// Lua: atomic toggle vote with a one-vote-per-hour cooldown.
// KEYS[1] = active vote key, KEYS[2] = cooldown key, KEYS[3] = count hash key
// ARGV[1] = action (vote|unvote), ARGV[2] = hourly TTL, ARGV[3] = count hash TTL, ARGV[4] = emoji field
// Returns [applied(0|1), newCount, active(0|1)]
const SCRIPT_VOTE = `
  local action = ARGV[1]
  local ttl = tonumber(ARGV[2])
  local countTtl = tonumber(ARGV[3])
  local emoji = ARGV[4]

  if action == 'vote' then
    if redis.call('exists', KEYS[1]) == 1 or redis.call('exists', KEYS[2]) == 1 then
      return {0, tonumber(redis.call('hget', KEYS[3], emoji) or '0'), 0}
    end
    redis.call('setex', KEYS[1], ttl, '1')
    local nc = redis.call('hincrby', KEYS[3], emoji, 1)
    redis.call('expire', KEYS[3], countTtl)
    return {1, nc, 1}
  end

  if redis.call('exists', KEYS[1]) == 1 then
    redis.call('del', KEYS[1])
    local nc = redis.call('hincrby', KEYS[3], emoji, -1)
    if nc < 0 then
      redis.call('hset', KEYS[3], emoji, '0')
      nc = 0
    end
    redis.call('setex', KEYS[2], ttl, '1')
    redis.call('expire', KEYS[3], countTtl)
    return {1, nc, 0}
  end

  return {0, tonumber(redis.call('hget', KEYS[3], emoji) or '0'), 0}
`;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("accountId");
  const date = searchParams.get("date");

  if (!accountId || !date || !DATE_RE.test(date)) {
    return NextResponse.json(
      { error: "accountId and date (YYYY-MM-DD) required" },
      { status: 400 },
    );
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
    // Single mGet instead of N exists calls
    const voted: string[] = [];
    if (!isNew) {
      const emojis = [...SPARKLINE_EMOJIS];
      const vals = await redis.mGet(
        emojis.map((e) => keys.hourlyLimit(sid, accountId, e)),
      );
      emojis.forEach((e, i) => {
        if (vals[i] !== null) voted.push(e);
      });
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
  if (!body)
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });

  const { accountId, date, emoji, action } = body as Record<string, unknown>;
  const requestAction = action === "unvote" ? "unvote" : "vote";

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
    const cooldownKey = keys.cooldown(sid, accountId, emoji);
    const cKey = keys.reactions(accountId, date);

    const [applied, newCount, active] = (await redis.eval(SCRIPT_VOTE, {
      keys: [hKey, cooldownKey, cKey],
      arguments: [
        requestAction,
        HOURLY_VOTE_TTL.toString(),
        SPARKLINE_TTL.toString(),
        emoji,
      ],
    })) as [number, number, number];

    if (applied === 0) {
      const res = NextResponse.json(
        { error: "hourly limit reached", voted: false },
        { status: 429 },
      );
      if (isNew) setSidCookie(res, sid);
      return res;
    }

    const res = NextResponse.json({
      count: Math.max(0, newCount),
      voted: active === 1,
    });
    if (isNew) setSidCookie(res, sid);
    return res;
  } catch {
    return NextResponse.json({ error: "redis unavailable" }, { status: 503 });
  }
}
