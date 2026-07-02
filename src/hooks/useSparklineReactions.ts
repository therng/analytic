"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveSparklineVoteTransition, type SparklineVoteAction } from "@/lib/social-shared";

export const EMOJIS = ["👍", "🎉", "🙄", "🤖", "💊", "😨", "✌️", "🙏", "🍚", "🥤"] as const;
export type SparklineEmoji = (typeof EMOJIS)[number];

// Chain tiers per emoji.pdf design doc
export const CHAINS: Record<SparklineEmoji, { tiers: string[]; thresholds: number[] }> = {
  "👍": { tiers: ["👍", "🎖️", "👑", "🕴️", "🎆"], thresholds: [0, 2, 5, 10, 20] },
  "🎉": { tiers: ["🎉", "👭", "👯", "🪩", "🎇"],  thresholds: [0, 3, 6, 12, 30] },
  "🙄": { tiers: ["🙄", "🤭", "🫡", "🥶", "🌌"],  thresholds: [0, 2, 5, 10, 20] },
  "🤖": { tiers: ["🤖", "💩", "🪲", "🖕", "👵"],  thresholds: [0, 3, 8, 16, 30] },
  "💊": { tiers: ["💊", "😨", "😱", "💆"],         thresholds: [0, 3, 10, 25] },
  "😨": { tiers: ["😨"], thresholds: [0] },
  "✌️": { tiers: ["✌️"], thresholds: [0] },
  "🙏": { tiers: ["🙏"], thresholds: [0] },
  "🍚": { tiers: ["🍚"], thresholds: [0] },
  "🥤": { tiers: ["🥤"], thresholds: [0] },
};

// Returns the single highest-tier emoji for the current count (used in picker)
export function resolveChainEmoji(emoji: SparklineEmoji, count: number): string {
  const chain = CHAINS[emoji];
  if (!chain || count === 0) return emoji;
  let resolved = chain.tiers[0];
  for (let i = 0; i < chain.thresholds.length; i++) {
    if (count >= chain.thresholds[i]) resolved = chain.tiers[i];
  }
  return resolved;
}

// Returns all unlocked tier emojis in order (base + each threshold reached)
export function resolveChainEmojis(emoji: SparklineEmoji, count: number): string[] {
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
  voted: Set<string>; // emojis voted within the last hour (server-authoritative)
  loading: boolean;
}

export function useSparklineReactions(accountId: string, date: string) {
  const [state, setState] = useState<SparklineReactionState>({
    counts: {},
    voted: new Set(),
    loading: true,
  });

  const pending = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!accountId || !date) return;
    setState((s) => ({ ...s, loading: true }));
    const controller = new AbortController();
    fetch(`/api/social/sparkline-reactions?accountId=${encodeURIComponent(accountId)}&date=${encodeURIComponent(date)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) =>
        setState((s) => ({
          ...s,
          counts: data.counts ?? {},
          voted: new Set<string>(data.voted ?? []),
          loading: false,
        }))
      )
      .catch((e) => {
        if (e.name !== "AbortError") {
          setState((s) => ({ ...s, loading: false }));
        }
      });
    return () => controller.abort();
  }, [accountId, date]);

  // Server is authoritative: voted if the current session has an active vote for this emoji
  function hasVoted(emoji: string): boolean {
    return state.voted.has(emoji);
  }

  const toggleVote = useCallback(
    async (emoji: SparklineEmoji) => {
      if (pending.current.has(emoji)) return;

      const currentlyVoted = state.voted.has(emoji);
      const action: SparklineVoteAction = currentlyVoted ? "unvote" : "vote";
      const transition = resolveSparklineVoteTransition(currentlyVoted, action);
      if (!transition.allowed) return;

      pending.current.add(emoji);

      const snapshotVoted = new Set(state.voted);
      const snapshotCount = state.counts[emoji] ?? 0;

      const nextVoted = new Set(state.voted);
      if (transition.nextVoted) nextVoted.add(emoji);
      else nextVoted.delete(emoji);

      setState((prev) => ({
        ...prev,
        voted: nextVoted,
        counts: {
          ...prev.counts,
          [emoji]: Math.max(0, (prev.counts[emoji] ?? 0) + transition.countDelta),
        },
      }));

      try {
        const res = await fetch("/api/social/sparkline-reactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId, date, emoji, action }),
        });
        const data = await res.json();
        if (res.ok && typeof data.count === "number" && typeof data.voted === "boolean") {
          setState((prev) => {
            const serverVoted = new Set(prev.voted);
            if (data.voted) serverVoted.add(emoji);
            else serverVoted.delete(emoji);
            return {
              ...prev,
              voted: serverVoted,
              counts: {
                ...prev.counts,
                [emoji]: data.count,
              },
            };
          });
        } else {
          setState((prev) => ({
            ...prev,
            voted: snapshotVoted,
            counts: { ...prev.counts, [emoji]: snapshotCount },
          }));
        }
      } catch {
        setState((prev) => ({
          ...prev,
          voted: snapshotVoted,
          counts: { ...prev.counts, [emoji]: snapshotCount },
        }));
      } finally {
        pending.current.delete(emoji);
      }
    },
    [state, accountId, date]
  );

  return { ...state, toggleVote, hasVoted, emojis: EMOJIS };
}
