"use client";
import { useCallback, useEffect, useState } from "react";

interface ReactionState {
  counts: Record<string, number>;
  mine: string[];
  loading: boolean;
}

export function useReactions(targetType: "ACCOUNT" | "SHOUT", targetId: string) {
  const [state, setState] = useState<ReactionState>({ counts: {}, mine: [], loading: true });

  useEffect(() => {
    if (!targetId) return;
    fetch(`/api/social/reactions?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`)
      .then((r) => r.json())
      .then((data) => setState({ counts: data.counts, mine: data.mine, loading: false }))
      .catch(() => setState((s) => ({ ...s, loading: false })));
  }, [targetType, targetId]);

  const toggle = useCallback(
    async (emoji: string) => {
      const alreadyMine = state.mine.includes(emoji);
      setState((prev) => ({
        ...prev,
        mine: alreadyMine ? prev.mine.filter((e) => e !== emoji) : [...prev.mine, emoji],
        counts: {
          ...prev.counts,
          [emoji]: (prev.counts[emoji] ?? 0) + (alreadyMine ? -1 : 1),
        },
      }));

      try {
        await fetch("/api/social/reactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetType, targetId, emoji }),
        });
      } catch {
        fetch(`/api/social/reactions?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`)
          .then((r) => r.json())
          .then((data) => setState({ counts: data.counts, mine: data.mine, loading: false }))
          .catch(() => {});
      }
    },
    [state, targetType, targetId]
  );

  return { ...state, toggle };
}
