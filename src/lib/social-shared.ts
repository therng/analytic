// Client-safe: no next/headers, no next/server, no Node built-ins. Shared
// between the server route (src/lib/social.ts re-exports these) and client
// components/hooks (which must import from here directly, not from
// src/lib/social.ts — that file pulls in next/headers and can't be bundled
// for the browser).

// ── Emoji sets ───────────────────────────────────────────────────────────────
// SPARKLINE_EMOJIS must stay in sync with EMOJIS in src/hooks/useSparklineReactions.ts
export const SPARKLINE_EMOJIS = new Set([
  "👍",
  "🎉",
  "🙄",
  "🤖",
  "💊",
  "😨",
  "✌️",
  "🙏",
  "🍚",
  "🥤",
]);
export const REACTION_EMOJIS = new Set(["🔥", "💎", "🎯", "👏", "😱"]);

// ── Validation ───────────────────────────────────────────────────────────────
export const VALID_TARGET_TYPES = new Set(["ACCOUNT", "SHOUT"]);
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const SID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

// ── TTL ──────────────────────────────────────────────────────────────────────
export const SPARKLINE_TTL = 60 * 60 * 24 * 30; // 30 days in seconds
export const HOURLY_VOTE_TTL = 60 * 60; // 1 hour in seconds

export type SparklineVoteAction = "vote" | "unvote";

export interface SparklineVoteTransition {
  action: SparklineVoteAction;
  allowed: boolean;
  nextVoted: boolean;
  countDelta: number;
}

export function resolveSparklineVoteTransition(
  currentlyVoted: boolean,
  requestedAction: SparklineVoteAction | null | undefined,
): SparklineVoteTransition {
  if (requestedAction === "unvote") {
    return currentlyVoted
      ? { action: "unvote", allowed: true, nextVoted: false, countDelta: -1 }
      : { action: "unvote", allowed: false, nextVoted: false, countDelta: 0 };
  }

  if (requestedAction === "vote") {
    return currentlyVoted
      ? { action: "vote", allowed: false, nextVoted: true, countDelta: 0 }
      : { action: "vote", allowed: true, nextVoted: true, countDelta: 1 };
  }

  return {
    action: "vote",
    allowed: false,
    nextVoted: currentlyVoted,
    countDelta: 0,
  };
}

// ── Redis key builders ───────────────────────────────────────────────────────
export const keys = {
  reactions: (accountId: string, date: string) =>
    `sparkline:reactions:${accountId}:${date}`,
  // Per-session active vote key — expires after HOURLY_VOTE_TTL
  hourlyLimit: (sid: string, accountId: string, emoji: string) =>
    `sparkline:vote:${sid}:${accountId}:${emoji}`,
  cooldown: (sid: string, accountId: string, emoji: string) =>
    `sparkline:cooldown:${sid}:${accountId}:${emoji}`,
};

// ── Reaction burst coordinates ──────────────────────────────────────────────
// A click event's `detail` is 0 for keyboard-activated (Enter/Space) and
// programmatic clicks — browsers set clientX/clientY to 0 for those too, so
// the burst must anchor to the button's own center instead of the pointer.
export function resolveBurstCoordinates(
  detail: number,
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  if (detail === 0) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  return { x: clientX, y: clientY };
}
