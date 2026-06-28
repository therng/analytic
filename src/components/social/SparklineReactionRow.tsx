"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  reactionPickerVariants,
  reactionCollapsedVariants,
  reactionBtnVariants,
  reactionBadgeVariants,
} from "@/lib/animations";
import {
  EMOJIS,
  resolveChainEmoji,
  useSparklineReactions,
  type SparklineEmoji,
} from "@/hooks/useSparklineReactions";
import { EmojiIcon } from "@/components/social/EmojiIcon";

interface SparklineReactionRowProps {
  accountId: string;
  date: string;
  triggerToggle?: number;
  onPlace?: (emoji: string, clientX: number, clientY: number) => void;
}

export function SparklineReactionRow({
  accountId,
  date,
  triggerToggle,
  onPlace,
}: SparklineReactionRowProps) {
  const { counts, toggle, hasVoted } = useSparklineReactions(accountId, date);
  const [open, setOpen] = useState(false);
  const prevTrigger = useRef(0);
  const reduceMotion = useReducedMotion() ?? false;
  const btnVariants = reactionBtnVariants(reduceMotion);

  const dragJustPlaced = useRef(false);
  const hasCounts = EMOJIS.some((e) => (counts[e] ?? 0) > 0);

  useEffect(() => {
    if (!triggerToggle || triggerToggle === prevTrigger.current) return;
    prevTrigger.current = triggerToggle;
    setOpen((prev) => !prev);
  }, [triggerToggle]);

  function handleSelect(emoji: SparklineEmoji) {
    toggle(emoji);
    setOpen(false);
  }

  function handleEmojiPointerDown(e: React.PointerEvent, emoji: SparklineEmoji) {
    if (!onPlace) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const display = resolveChainEmoji(emoji, counts[emoji] ?? 0);
    let ghost: HTMLDivElement | null = null;
    let active = false;
    let cancelled = false;

    function onMove(ev: PointerEvent) {
      if (cancelled) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!active && Math.sqrt(dx * dx + dy * dy) > 14) {
        active = true;
        ghost = document.createElement("div");
        ghost.className = "emoji-place-ghost";
        ghost.textContent = display;
        document.body.appendChild(ghost);
      }
      if (active && ghost) {
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;
      }
    }

    function onUp(ev: PointerEvent) {
      cancelled = true;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (ghost) { ghost.remove(); ghost = null; }
      if (active && onPlace) {
        dragJustPlaced.current = true;
        onPlace(display, ev.clientX, ev.clientY);
        setOpen(false);
      }
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  return (
    <div className="sparkline-reaction-row-anchor">
      <AnimatePresence mode="wait">
        {open ? (
          <motion.div
            key="picker"
            className="sparkline-reaction-row sparkline-reaction-row--open"
            variants={reactionPickerVariants}
            initial="hidden"
            animate="show"
            exit="exit"
            aria-label="Reactions"
          >
            {EMOJIS.map((emoji) => {
              const count = counts[emoji] ?? 0;
              const voted = hasVoted(emoji);
              const display = resolveChainEmoji(emoji, count);
              return (
                <motion.button
                  key={emoji}
                  variants={btnVariants}
                  className={`sparkline-reaction-btn${voted ? " sparkline-reaction-btn--active" : ""}`}
                  onClick={() => {
                    if (dragJustPlaced.current) { dragJustPlaced.current = false; return; }
                    handleSelect(emoji);
                  }}
                  onPointerDown={(e) => handleEmojiPointerDown(e, emoji)}
                  whileHover={reduceMotion ? undefined : { scale: 1.14 }}
                  whileTap={reduceMotion ? undefined : { scale: 0.86 }}
                  transition={{ type: "spring", stiffness: 600, damping: 22 }}
                  aria-label={`${display} ${count}`}
                  aria-pressed={voted}
                >
                  <EmojiIcon emoji={display} size={28} className="sparkline-reaction-emoji" />
                  {count > 0 && (
                    <span className="sparkline-reaction-count">{count}</span>
                  )}
                </motion.button>
              );
            })}
          </motion.div>
        ) : hasCounts ? (
          <motion.div
            key="badges"
            className="sparkline-reaction-row sparkline-reaction-row--collapsed"
            initial="hidden"
            animate="show"
            exit="hidden"
            variants={reactionCollapsedVariants}
            transition={{ duration: 0.15 }}
            role="presentation"
            aria-hidden="true"
          >
            {EMOJIS.map((emoji) => {
              const count = counts[emoji] ?? 0;
              if (count === 0) return null;
              return (
                <motion.span
                  key={emoji}
                  className="sparkline-chain-badge"
                  variants={reactionBadgeVariants}
                >
                  <EmojiIcon emoji={resolveChainEmoji(emoji, count)} size={20} />
                  <span className="sparkline-chain-count">{count}</span>
                </motion.span>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
