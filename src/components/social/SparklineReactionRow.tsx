"use client";
import { useSparklineReactions } from "@/hooks/useSparklineReactions";

interface SparklineReactionRowProps {
  accountId: string;
  date: string;
}

export function SparklineReactionRow({ accountId, date }: SparklineReactionRowProps) {
  const { counts, voted, toggle, emojis } = useSparklineReactions(accountId, date);

  return (
    <div className="sparkline-reaction-row" aria-label="Reactions">
      {emojis.map((emoji) => {
        const count = counts[emoji] ?? 0;
        const active = voted.has(emoji);
        return (
          <button
            key={emoji}
            className={`sparkline-reaction-btn${active ? " sparkline-reaction-btn--active" : ""}`}
            onClick={() => toggle(emoji)}
            aria-label={`${emoji} ${count}`}
            aria-pressed={active}
          >
            <span className="sparkline-reaction-emoji">{emoji}</span>
            {count > 0 && (
              <span className="sparkline-reaction-count">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
