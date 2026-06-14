"use client";
import { useReactions } from "@/hooks/useReactions";
import { useSocialSession } from "@/hooks/useSocialSession";

const EMOJIS = ["🔥", "💎", "🎯", "👏", "😱"] as const;

interface EmojiReactionBarProps {
  targetType: "ACCOUNT" | "SHOUT";
  targetId: string;
  compact?: boolean;
}

export function EmojiReactionBar({ targetType, targetId, compact = false }: EmojiReactionBarProps) {
  const { counts, mine, toggle } = useReactions(targetType, targetId);
  const session = useSocialSession();
  const canReact = session.status === "authenticated";

  return (
    <div
      style={{
        display: "flex",
        gap: compact ? "4px" : "6px",
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      {EMOJIS.map((emoji) => {
        const count = counts[emoji] ?? 0;
        const active = mine.includes(emoji);
        if (compact && count === 0 && !canReact) return null;
        return (
          <button
            key={emoji}
            onClick={() => canReact && toggle(emoji)}
            disabled={!canReact}
            aria-label={`React with ${emoji}, ${count} reactions`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "2px",
              padding: compact ? "2px 5px" : "3px 7px",
              borderRadius: "12px",
              border: active
                ? "1px solid var(--accent-blue, #3b82f6)"
                : "1px solid rgba(255,255,255,0.12)",
              background: active
                ? "rgba(59,130,246,0.15)"
                : "rgba(255,255,255,0.05)",
              cursor: canReact ? "pointer" : "default",
              fontSize: compact ? "12px" : "13px",
              color: "inherit",
              opacity: !canReact && count === 0 ? 0.4 : 1,
              transition: "background 0.15s, border-color 0.15s",
            }}
          >
            <span>{emoji}</span>
            {count > 0 && (
              <span style={{ fontSize: "11px", fontVariantNumeric: "tabular-nums" }}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
