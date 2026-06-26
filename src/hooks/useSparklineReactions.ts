"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export const EMOJIS = ["👍", "🎉", "🫣", "💩", "💊"] as const;
export type SparklineEmoji = (typeof EMOJIS)[number];

// Chain tiers per emoji.pdf design doc
export const CHAINS: Record<SparklineEmoji, { tiers: string[]; thresholds: number[] }> = {
  "👍": { tiers: ["👍", "👩", "👯‍♀️", "👯", "🎆"], thresholds: [0, 2, 5, 10, 20] },
  "🎉": { tiers: ["🎉", "👯‍♂️", "👯", "💃", "🎇"], thresholds: [0, 3, 6, 12, 30] },
  "🫣": { tiers: ["🫣", "🙄", "😱", "🥶", "🌌"], thresholds: [0, 2, 5, 10, 20] },
  "💩": { tiers: ["💩", "🖕", "🙏", "🪩"], thresholds: [0, 3, 8, 16] },
  "💊": { tiers: ["💊", "👨", "👵"], thresholds: [0, 3, 10] },
};

export function resolveChainEmoji(emoji: SparklineEmoji, count: number): string {
  const chain = CHAINS[emoji];
  if (!chain || count === 0) return emoji;
  let resolved = chain.tiers[0];
  for (let i = 0; i < chain.thresholds.length; i++) {
    if (count >= chain.thresholds[i]) resolved = chain.tiers[i];
  }
  return resolved;
}

interface SparklineReactionState {
  counts: Record<string, number>;
  voted: Set<string>; // server-authoritative: emojis this session has voted for
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

  // Server is authoritative: voted if sr_sid is in the voter set for this emoji
  function hasVoted(emoji: string): boolean {
    return state.voted.has(emoji);
  }

  const toggle = useCallback(
    async (emoji: SparklineEmoji) => {
      if (pending.current.has(emoji)) return;
      pending.current.add(emoji);

      const wasVoted = state.voted.has(emoji);
      const delta = wasVoted ? -1 : 1;

      // Snapshot pre-optimistic values for rollback — avoids stale closure issues
      const snapshotVoted = new Set(state.voted);
      const snapshotCount = state.counts[emoji] ?? 0;

      // Optimistic update
      const nextVoted = new Set(state.voted);
      if (wasVoted) nextVoted.delete(emoji);
      else nextVoted.add(emoji);

      setState((prev) => ({
        ...prev,
        voted: nextVoted,
        counts: { ...prev.counts, [emoji]: Math.max(0, (prev.counts[emoji] ?? 0) + delta) },
      }));

      try {
        const res = await fetch("/api/social/sparkline-reactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId, date, emoji, delta }),
        });
        const data = await res.json();
        // Reconcile with server count and voted state
        if (typeof data.count === "number" || typeof data.voted === "boolean") {
          setState((prev) => {
            const serverVoted = new Set(prev.voted);
            if (typeof data.voted === "boolean") {
              if (data.voted) serverVoted.add(emoji);
              else serverVoted.delete(emoji);
            }
            return {
              ...prev,
              voted: serverVoted,
              counts: {
                ...prev.counts,
                ...(typeof data.count === "number" ? { [emoji]: data.count } : {}),
              },
            };
          });
        }
      } catch {
        // Rollback to pre-optimistic snapshot — avoids touching other emojis' state
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

  return { ...state, toggle, hasVoted, emojis: EMOJIS };
}
