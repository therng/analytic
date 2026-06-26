export function EmojiIcon({
  emoji,
  size = 20,
  className,
}: {
  emoji: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={className}
      style={{ fontSize: size, lineHeight: 1, display: "inline-block" }}
      aria-hidden="true"
    >
      {emoji}
    </span>
  );
}
