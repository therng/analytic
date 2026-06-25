"use client";
import { useCallback, useEffect, useState } from "react";

const EMOJIS = ["👍", "🎉", "😱"] as const;
type SparklineEmoji = (typeof EMOJIS)[number];

interface SparklineReactionState {
  counts: Record<string, number>;
  voted: Set<string>;
  loading: boolean;
}

function localKey(accountId: string, date: string) {
  return `sr:${accountId}:${date}`;
}

function loadVoted(accountId: string, date: string): Set<string> {
  try {
    const raw = localStorage.getItem(localKey(accountId, date));
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveVoted(accountId: string, date: string, voted: Set<string>) {
  try {
    localStorage.setItem(localKey(accountId, date), JSON.stringify([...voted]));
  } catch {}
}

export function useSparklineReactions(accountId: string, date: string) {
  const [state, setState] = useState<SparklineReactionState>({
    counts: {},
    voted: new Set(),
    loading: true,
  });

  useEffect(() => {
    if (!accountId || !date) return;
    const voted = loadVoted(accountId, date);
    setState((s) => ({ ...s, voted, loading: true }));
    fetch(`/api/social/sparkline-reactions?accountId=${encodeURIComponent(accountId)}&date=${date}`)
      .then((r) => r.json())
      .then((data) => setState((s) => ({ ...s, counts: data.counts ?? {}, loading: false })))
      .catch(() => setState((s) => ({ ...s, loading: false })));
  }, [accountId, date]);

  const toggle = useCallback(
    async (emoji: SparklineEmoji) => {
      const alreadyVoted = state.voted.has(emoji);
      const delta = alreadyVoted ? -1 : 1;

      // Optimistic update
      const nextVoted = new Set(state.voted);
      if (alreadyVoted) nextVoted.delete(emoji);
      else nextVoted.add(emoji);

      setState((prev) => ({
        ...prev,
        voted: nextVoted,
        counts: {
          ...prev.counts,
          [emoji]: Math.max(0, (prev.counts[emoji] ?? 0) + delta),
        },
      }));
      saveVoted(accountId, date, nextVoted);

      try {
        await fetch("/api/social/sparkline-reactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId, date, emoji, delta }),
        });
      } catch {
        // Revert on failure
        setState((prev) => ({
          ...prev,
          voted: state.voted,
          counts: {
            ...prev.counts,
            [emoji]: Math.max(0, (prev.counts[emoji] ?? 0)),
          },
        }));
        saveVoted(accountId, date, state.voted);
      }
    },
    [state, accountId, date]
  );

  return { ...state, toggle, emojis: EMOJIS };
}
