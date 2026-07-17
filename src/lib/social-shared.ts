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

// A session holds at most one active emoji per account/date (radio, not
// checkboxes). Tapping the active emoji clears it; tapping another emoji
// switches to it.
export interface SparklineVoteTransition {
  nextActive: string | null;
}

export function resolveSparklineVoteTransition(
  currentActive: string | null,
  emoji: string,
): SparklineVoteTransition {
  return { nextActive: currentActive === emoji ? null : emoji };
}

// ── Redis key builders ───────────────────────────────────────────────────────
export const keys = {
  reactions: (accountId: string, date: string) =>
    `sparkline:reactions:${accountId}:${date}`,
  // Per-session single active emoji — expires after HOURLY_VOTE_TTL
  active: (sid: string, accountId: string, date: string) =>
    `sparkline:active:${sid}:${accountId}:${date}`,
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

// ── Reaction picker positioning ─────────────────────────────────────────────
export function resolveCenteredPickerLeft(
  anchorLeft: number,
  anchorWidth: number,
  pickerWidth: number,
  viewportWidth: number,
  edgeInset = 8,
): number {
  const centeredLeft = anchorLeft + anchorWidth / 2 - pickerWidth / 2;
  const maxLeft = Math.max(edgeInset, viewportWidth - pickerWidth - edgeInset);
  return Math.max(edgeInset, Math.min(centeredLeft, maxLeft));
}

export function resolvePickerTop(
  anchorBottom: number,
  pickerHeight: number,
  viewportHeight: number,
  edgeInset = 8,
  anchorOverlap = 36,
): number {
  const anchoredTop = anchorBottom - anchorOverlap;
  const maxTop = Math.max(
    edgeInset,
    viewportHeight - pickerHeight - edgeInset,
  );
  return Math.max(edgeInset, Math.min(anchoredTop, maxTop));
}

// Keep a three-copy horizontal carousel inside its middle copy. Shifting by
// one complete segment is visually identical, so the correction is seamless.
export function normalizeInfiniteScrollLeft(
  scrollLeft: number,
  segmentWidth: number,
): number {
  if (segmentWidth <= 0) return scrollLeft;

  const lowerBoundary = segmentWidth / 2;
  const upperBoundary = segmentWidth * 1.5;
  let normalized = scrollLeft;

  while (normalized < lowerBoundary) normalized += segmentWidth;
  while (normalized >= upperBoundary) normalized -= segmentWidth;

  return normalized;
}
