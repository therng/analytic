"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  reactionCollapsedVariants,
  reactionBtnVariants,
  reactionBadgeVariants,
} from "@/lib/animations";
import {
  EMOJIS,
  useSparklineReactions,
  type SparklineEmoji,
} from "@/hooks/useSparklineReactions";
import { EmojiIcon } from "@/components/social/EmojiIcon";

interface SparklineReactionRowProps {
  accountId: string;
  date: string;
  triggerToggle?: number;
  onPlace?: (emoji: string, clientX: number, clientY: number) => void;
  shellRef?: React.RefObject<HTMLDivElement | null>;
}

export function SparklineReactionRow({
  accountId,
  date,
  triggerToggle,
  onPlace,
  shellRef,
}: SparklineReactionRowProps) {
  const { counts, toggle, hasVoted } = useSparklineReactions(accountId, date);
  const [open, setOpen] = useState(false);
  const prevTrigger = useRef(0);
  const reduceMotion = useReducedMotion() ?? false;
  const btnVariants = reactionBtnVariants(reduceMotion);
  const dragJustPlaced = useRef(false);
  const hasCounts = EMOJIS.some((e) => (counts[e] ?? 0) > 0);

  const [pickerStyle, setPickerStyle] = useState<React.CSSProperties>({});

  // Compute fixed viewport position from chart shell rect
  useLayoutEffect(() => {
    if (!open || !shellRef?.current) return;
    const rect = shellRef.current.getBoundingClientRect();
    setPickerStyle({
      position: "fixed",
      left: rect.left,
      right: window.innerWidth - rect.right,
      top: rect.bottom - 64,
      bottom: window.innerHeight - rect.bottom - 60,
      zIndex: 9999,
    });
  }, [open, shellRef]);

  // Close picker if the card scrolls (fixed position drifts)
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [open]);

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
        ghost.textContent = emoji;
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
        onPlace(emoji, ev.clientX, ev.clientY);
        setOpen(false);
      }
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  return (
    <div className="sparkline-reaction-row-anchor">
      {/* Collapsed badges — display-only, no pointer events */}
      <AnimatePresence>
        {!open && hasCounts ? (
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
                  <EmojiIcon emoji={emoji} size={20} />
                  <span className="sparkline-chain-count">{count}</span>
                </motion.span>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Open picker — portal, overlays sparkline bottom + kpi-stack */}
      {typeof window !== "undefined" && createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              key="picker-portal"
              className="sparkline-picker-portal"
              style={pickerStyle}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.14 }}
              aria-label="Reactions"
            >
              {EMOJIS.map((emoji) => {
                const count = counts[emoji] ?? 0;
                const voted = hasVoted(emoji);
                return (
                  <motion.button
                    key={emoji}
                    variants={btnVariants}
                    className={`sparkline-reaction-btn sparkline-reaction-btn--portal${voted ? " sparkline-reaction-btn--active" : ""}`}
                    onClick={() => {
                      if (dragJustPlaced.current) { dragJustPlaced.current = false; return; }
                      handleSelect(emoji);
                    }}
                    onPointerDown={(e) => handleEmojiPointerDown(e, emoji)}
                    whileHover={reduceMotion ? undefined : { scale: 1.1 }}
                    whileTap={reduceMotion ? undefined : { scale: 0.88 }}
                    transition={{ type: "spring", stiffness: 600, damping: 22 }}
                    aria-label={`${emoji} ${count}`}
                    aria-pressed={voted}
                  >
                    <EmojiIcon emoji={emoji} size={34} className="sparkline-reaction-emoji" />
                    {count > 0 && (
                      <span className="sparkline-reaction-count">{count}</span>
                    )}
                  </motion.button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
