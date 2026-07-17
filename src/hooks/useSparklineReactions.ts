"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveSparklineVoteTransition } from "@/lib/social-shared";

export const EMOJIS = [
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
] as const;
export type SparklineEmoji = (typeof EMOJIS)[number];

// Chain tiers per emoji.pdf design doc
export const CHAINS: Record<
  SparklineEmoji,
  { tiers: string[]; thresholds: number[] }
> = {
  "👍": {
    tiers: ["👍", "🎖️", "👑", "🕴️", "🎆"],
    thresholds: [0, 2, 5, 10, 20],
  },
  "🎉": {
    tiers: ["🎉", "👭", "👯", "🪩", "🎇"],
    thresholds: [0, 3, 6, 12, 30],
  },
  "🙄": {
    tiers: ["🙄", "🤭", "🫡", "🥶", "🌌"],
    thresholds: [0, 2, 5, 10, 20],
  },
  "🤖": {
    tiers: ["🤖", "💩", "🪲", "🖕", "👵"],
    thresholds: [0, 3, 8, 16, 30],
  },
  "💊": { tiers: ["💊", "😨", "😱", "💆"], thresholds: [0, 3, 10, 25] },
  "😨": { tiers: ["😨"], thresholds: [0] },
  "✌️": { tiers: ["✌️"], thresholds: [0] },
  "🙏": { tiers: ["🙏"], thresholds: [0] },
  "🍚": { tiers: ["🍚"], thresholds: [0] },
  "🥤": { tiers: ["🥤"], thresholds: [0] },
};

// Returns the single highest-tier emoji for the current count (used in picker)
export function resolveChainEmoji(
  emoji: SparklineEmoji,
  count: number,
): string {
  const chain = CHAINS[emoji];
  if (!chain || count === 0) return emoji;
  let resolved = chain.tiers[0];
  for (let i = 0; i < chain.thresholds.length; i++) {
    if (count >= chain.thresholds[i]) resolved = chain.tiers[i];
  }
  return resolved;
}

// Returns all unlocked tier emojis in order (base + each threshold reached)
export function resolveChainEmojis(
  emoji: SparklineEmoji,
  count: number,
): string[] {
  const chain = CHAINS[emoji];
  if (!chain || count === 0) return [emoji];
  const unlocked: string[] = [];
  for (let i = 0; i < chain.thresholds.length; i++) {
    if (count >= chain.thresholds[i]) unlocked.push(chain.tiers[i]);
    else break;
  }
  return unlocked.length > 0 ? unlocked : [emoji];
}

interface SparklineReactionState {
  counts: Record<string, number>;
  active: string | null; // the single emoji this session voted for (server-authoritative)
  loading: boolean;
}

export function useSparklineReactions(accountId: string, date: string) {
  const [state, setState] = useState<SparklineReactionState>({
    counts: {},
    active: null,
    loading: true,
  });

  const pending = useRef(false);

  useEffect(() => {
    if (!accountId || !date) return;
    setState((s) => ({ ...s, loading: true }));
    const controller = new AbortController();
    fetch(
      `/api/social/sparkline-reactions?accountId=${encodeURIComponent(accountId)}&date=${encodeURIComponent(date)}`,
      {
        signal: controller.signal,
      },
    )
      .then((r) => r.json())
      .then((data) =>
        setState((s) => ({
          ...s,
          counts: data.counts ?? {},
          active: data.active ?? null,
          loading: false,
        })),
      )
      .catch((e) => {
        if (e.name !== "AbortError") {
          setState((s) => ({ ...s, loading: false }));
        }
      });
    return () => controller.abort();
  }, [accountId, date]);

  // Server is authoritative: voted if this session's single active emoji matches
  function hasVoted(emoji: string): boolean {
    return state.active === emoji;
  }

  const toggleVote = useCallback(
    async (emoji: SparklineEmoji) => {
      if (pending.current) return;
      pending.current = true;

      const snapshot = state;
      const { nextActive } = resolveSparklineVoteTransition(
        state.active,
        emoji,
      );

      setState((prev) => {
        const counts = { ...prev.counts };
        if (prev.active)
          counts[prev.active] = Math.max(0, (counts[prev.active] ?? 0) - 1);
        if (nextActive)
          counts[nextActive] = (counts[nextActive] ?? 0) + 1;
        return { ...prev, active: nextActive, counts };
      });

      try {
        const res = await fetch("/api/social/sparkline-reactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId, date, emoji }),
        });
        const data = await res.json();
        if (res.ok && data.counts) {
          setState((prev) => ({
            ...prev,
            counts: data.counts,
            active: data.active ?? null,
          }));
        } else {
          setState((prev) => ({ ...prev, ...snapshot }));
        }
      } catch {
        setState((prev) => ({ ...prev, ...snapshot }));
      } finally {
        pending.current = false;
      }
    },
    [state, accountId, date],
  );

  return { ...state, toggleVote, hasVoted, emojis: EMOJIS };
}
