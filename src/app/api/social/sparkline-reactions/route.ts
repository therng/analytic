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

// Lua: atomic single-active-emoji toggle. A session holds at most one active
// emoji per account/date — voting a new emoji switches off whichever was
// active before.
// KEYS[1] = active emoji key, KEYS[2] = count hash key
// ARGV[1] = requested emoji, ARGV[2] = active TTL, ARGV[3] = count hash TTL
// Returns [activeEmoji|'', flat counts array]
const SCRIPT_VOTE = `
  local emoji = ARGV[1]
  local ttl = tonumber(ARGV[2])
  local countTtl = tonumber(ARGV[3])
  local current = redis.call('get', KEYS[1])
  local activeEmoji = ''

  if current == emoji then
    redis.call('del', KEYS[1])
    if tonumber(redis.call('hincrby', KEYS[2], emoji, -1)) < 0 then
      redis.call('hset', KEYS[2], emoji, '0')
    end
  else
    if current then
      if tonumber(redis.call('hincrby', KEYS[2], current, -1)) < 0 then
        redis.call('hset', KEYS[2], current, '0')
      end
    end
    redis.call('setex', KEYS[1], ttl, emoji)
    redis.call('hincrby', KEYS[2], emoji, 1)
    activeEmoji = emoji
  end

  redis.call('expire', KEYS[2], countTtl)
  return {activeEmoji, redis.call('hgetall', KEYS[2])}
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

    // "active" = the single emoji this session voted for (radio, not checkboxes)
    const active = isNew
      ? null
      : await redis.get(keys.active(sid, accountId, date));

    const res = NextResponse.json({ counts, active });
    if (isNew) setSidCookie(res, sid);
    return res;
  } catch {
    const res = NextResponse.json({ counts: {}, active: null });
    if (isNew) setSidCookie(res, sid);
    return res;
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: "invalid payload" }, { status: 400 });

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

    const aKey = keys.active(sid, accountId, date);
    const cKey = keys.reactions(accountId, date);

    const [activeEmoji, flatCounts] = (await redis.eval(SCRIPT_VOTE, {
      keys: [aKey, cKey],
      arguments: [emoji, HOURLY_VOTE_TTL.toString(), SPARKLINE_TTL.toString()],
    })) as [string, string[]];

    const counts: Record<string, number> = {};
    for (let i = 0; i < flatCounts.length; i += 2) {
      const e = flatCounts[i];
      const n = parseInt(flatCounts[i + 1], 10);
      if (SPARKLINE_EMOJIS.has(e) && n > 0) counts[e] = n;
    }

    const res = NextResponse.json({
      counts,
      active: activeEmoji || null,
    });
    if (isNew) setSidCookie(res, sid);
    return res;
  } catch {
    return NextResponse.json({ error: "redis unavailable" }, { status: 503 });
  }
}
