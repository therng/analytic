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
  triggerOpen?: number;
}

const AUTO_CLOSE_MS = 3000;

export function SparklineReactionRow({
  accountId,
  date,
  triggerOpen,
}: SparklineReactionRowProps) {
  const { counts, toggle, hasVoted } = useSparklineReactions(accountId, date);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevTrigger = useRef(triggerOpen ?? 0);
  const reduceMotion = useReducedMotion() ?? false;
  const btnVariants = reactionBtnVariants(reduceMotion);

  const hasCounts = EMOJIS.some((e) => (counts[e] ?? 0) > 0);

  useEffect(() => {
    if (!triggerOpen || triggerOpen === prevTrigger.current) return;
    prevTrigger.current = triggerOpen;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
    closeTimer.current = setTimeout(() => setOpen(false), AUTO_CLOSE_MS);
  }, [triggerOpen]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  function handleSelect(emoji: SparklineEmoji) {
    toggle(emoji);
    setOpen(false);
    if (closeTimer.current) clearTimeout(closeTimer.current);
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
                  onClick={() => handleSelect(emoji)}
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
