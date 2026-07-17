"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  reactionCollapsedVariants,
  reactionBtnVariants,
  reactionBadgeVariants,
  pickerPortal,
} from "@/lib/animations";
import {
  normalizeInfiniteScrollLeft,
  resolveBurstCoordinates,
  resolveCenteredPickerLeft,
  resolvePickerTop,
} from "@/lib/social-shared";
import {
  EMOJIS,
  useSparklineReactions,
  type SparklineEmoji,
} from "@/hooks/useSparklineReactions";

interface SparklineReactionRowProps {
  accountId: string;
  date: string;
  triggerToggle?: number;
  onPlace?: (emoji: string, clientX: number, clientY: number) => void;
  shellRef?: React.RefObject<HTMLDivElement | null>;
}

const PORTRAIT_LOOP_QUERY = "(max-width: 480px) and (orientation: portrait)";
const LOOP_COPIES = [0, 1, 2] as const;

export function SparklineReactionRow({
  accountId,
  date,
  triggerToggle,
  onPlace,
  shellRef,
}: SparklineReactionRowProps) {
  const { counts, toggleVote, hasVoted } = useSparklineReactions(
    accountId,
    date,
  );
  const [open, setOpen] = useState(false);
  const prevTrigger = useRef(0);
  const reduceMotion = useReducedMotion() ?? false;
  const btnVariants = reactionBtnVariants(reduceMotion);
  const dragJustPlaced = useRef(false);
  const suppressClickTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const hasCounts = EMOJIS.some((e) => (counts[e] ?? 0) > 0);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [previewEmoji, setPreviewEmoji] = useState<SparklineEmoji | null>(null);

  const [pickerStyle, setPickerStyle] = useState<React.CSSProperties>({});

  useEffect(
    () => () => {
      if (suppressClickTimeout.current)
        clearTimeout(suppressClickTimeout.current);
    },
    [],
  );

  // Measure the rendered pill instead of duplicating its responsive CSS width.
  // Avoid CSS translate here: framer-motion owns the transform pipeline.
  useLayoutEffect(() => {
    if (!open) return;

    const positionPicker = () => {
      const shell = shellRef?.current;
      const picker = pickerRef.current;
      if (!shell || !picker) return;

      const shellRect = shell.getBoundingClientRect();
      const pickerRect = picker.getBoundingClientRect();
      setPickerStyle({
        position: "fixed",
        left: resolveCenteredPickerLeft(
          shellRect.left,
          shellRect.width,
          pickerRect.width,
          window.innerWidth,
        ),
        top: resolvePickerTop(
          shellRect.bottom,
          pickerRect.height,
          window.innerHeight,
        ),
        zIndex: 9999,
      });

      if (window.matchMedia(PORTRAIT_LOOP_QUERY).matches) {
        const centerCopy = picker.querySelector<HTMLElement>(
          '[data-loop-copy="center"]',
        );
        if (centerCopy) picker.scrollLeft = centerCopy.offsetLeft;
      } else {
        picker.scrollLeft = 0;
      }
    };

    positionPicker();
    window.addEventListener("resize", positionPicker);
    window.visualViewport?.addEventListener("resize", positionPicker);
    return () => {
      window.removeEventListener("resize", positionPicker);
      window.visualViewport?.removeEventListener("resize", positionPicker);
    };
  }, [open, shellRef]);

  // Close picker if the card scrolls (fixed position drifts)
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      const picker = pickerRef.current;
      if (picker && event.target instanceof Node && picker.contains(event.target))
        return;
      setOpen(false);
    };
    window.addEventListener("scroll", close, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [open]);

  useEffect(() => {
    if (!triggerToggle || triggerToggle === prevTrigger.current) return;
    prevTrigger.current = triggerToggle;
    setOpen((prev) => !prev);
  }, [triggerToggle]);

  function spawnReactionBurst(emoji: string, x: number, y: number) {
    const el = document.createElement("div");
    el.className = "reaction-select-burst";
    el.textContent = emoji;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    document.body.appendChild(el);
    el.addEventListener("animationend", () => el.remove());
  }

  function handleSelect(emoji: SparklineEmoji, x?: number, y?: number) {
    const wasVoted = hasVoted(emoji);
    toggleVote(emoji);
    if (!wasVoted && x != null && y != null && !reduceMotion)
      spawnReactionBurst(emoji, x, y);
    setOpen(false);
  }

  function suppressTrailingClick() {
    dragJustPlaced.current = true;
    if (suppressClickTimeout.current)
      clearTimeout(suppressClickTimeout.current);
    suppressClickTimeout.current = setTimeout(() => {
      dragJustPlaced.current = false;
      suppressClickTimeout.current = null;
    }, 500);
  }

  // Touch-keyboard-style select: press an emoji, slide across neighbors while
  // still held to preview whichever one is under the pointer, release to vote
  // for that one. A press-release with no movement behaves like a plain tap.
  // Sliding the pointer *out of the picker* hands off to the pre-existing
  // drag-to-place-on-chart gesture instead (only available for un-voted emoji).
  function withinPicker(x: number, y: number): boolean {
    const el = pickerRef.current;
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const PAD = 22; // forgiving hit-slop so a slightly sloppy slide doesn't fall out
    return (
      x >= rect.left - PAD &&
      x <= rect.right + PAD &&
      y >= rect.top - PAD &&
      y <= rect.bottom + PAD
    );
  }

  function emojiButtonAt(x: number, y: number): SparklineEmoji | null {
    const el = pickerRef.current;
    if (!el) return null;
    const buttons = el.querySelectorAll<HTMLButtonElement>("[data-emoji]");
    for (const btn of buttons) {
      const r = btn.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return btn.dataset.emoji as SparklineEmoji;
      }
    }
    return null;
  }

  function handleEmojiPointerDown(
    e: React.PointerEvent,
    emoji: SparklineEmoji,
  ) {
    const allowPortraitSwipe =
      e.pointerType === "touch" &&
      window.matchMedia(PORTRAIT_LOOP_QUERY).matches;
    if (!allowPortraitSwipe) e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const originVoted = hasVoted(emoji);
    let ghost: HTMLDivElement | null = null;
    let ghostActive = false;
    let cancelled = false;
    let horizontalSwipe = false;
    let slideEmoji: SparklineEmoji = emoji;
    setPreviewEmoji(emoji);

    function cleanup() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      setPreviewEmoji(null);
      if (ghost) {
        ghost.remove();
        ghost = null;
      }
    }

    function onMove(ev: PointerEvent) {
      if (cancelled) return;

      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (
        allowPortraitSwipe &&
        !ghostActive &&
        Math.abs(dx) > 8 &&
        Math.abs(dx) > Math.abs(dy)
      ) {
        horizontalSwipe = true;
        setPreviewEmoji(null);
        return;
      }
      if (horizontalSwipe) return;

      if (!ghostActive && withinPicker(ev.clientX, ev.clientY)) {
        const hit = emojiButtonAt(ev.clientX, ev.clientY);
        if (hit !== slideEmoji) {
          slideEmoji = hit ?? slideEmoji;
          setPreviewEmoji(hit);
        }
        return;
      }

      if (!onPlace || originVoted) return;
      if (!ghostActive && Math.sqrt(dx * dx + dy * dy) > 14) {
        ghostActive = true;
        setPreviewEmoji(null);
        ghost = document.createElement("div");
        ghost.className = "emoji-place-ghost";
        ghost.textContent = emoji;
        document.body.appendChild(ghost);
      }
      if (ghostActive && ghost) {
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;
      }
    }

    function onUp(ev: PointerEvent) {
      cancelled = true;
      cleanup();

      if (horizontalSwipe) {
        suppressTrailingClick();
        return;
      }

      if (ghostActive && onPlace) {
        dragJustPlaced.current = true;
        onPlace(emoji, ev.clientX, ev.clientY);
        setOpen(false);
        return;
      }

      if (withinPicker(ev.clientX, ev.clientY)) {
        const hit = emojiButtonAt(ev.clientX, ev.clientY) ?? slideEmoji;
        dragJustPlaced.current = true; // suppress the trailing click, we already voted
        handleSelect(hit, ev.clientX, ev.clientY);
      }
    }

    function onCancel() {
      cancelled = true;
      if (horizontalSwipe) suppressTrailingClick();
      cleanup();
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
  }

  function handlePickerScroll() {
    const picker = pickerRef.current;
    if (!picker || !window.matchMedia(PORTRAIT_LOOP_QUERY).matches) return;

    const centerCopy = picker.querySelector<HTMLElement>(
      '[data-loop-copy="center"]',
    );
    const segmentWidth = centerCopy?.offsetWidth ?? 0;
    const normalized = normalizeInfiniteScrollLeft(
      picker.scrollLeft,
      segmentWidth,
    );
    if (Math.abs(normalized - picker.scrollLeft) > 0.5) {
      picker.scrollLeft = normalized;
    }
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
                  <span
                    style={{
                      fontSize: 20,
                      lineHeight: 1,
                      display: "inline-block",
                    }}
                    aria-hidden="true"
                  >
                    {emoji}
                  </span>
                  <span className="sparkline-chain-count">{count}</span>
                </motion.span>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Open picker — portal, overlays sparkline bottom + kpi-stack */}
      {typeof window !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                key="picker-portal"
                ref={pickerRef}
                className="sparkline-picker-portal"
                style={pickerStyle}
                {...pickerPortal}
                onScroll={handlePickerScroll}
                role="group"
                aria-label="Reactions"
              >
                <div className="sparkline-picker-track">
                  {LOOP_COPIES.map((copyIndex) => {
                    const isCenterCopy = copyIndex === 1;
                    return (
                      <div
                        key={copyIndex}
                        className={`sparkline-picker-copy${isCenterCopy ? " sparkline-picker-copy--center" : " sparkline-picker-copy--clone"}`}
                        data-loop-copy={isCenterCopy ? "center" : "clone"}
                        aria-hidden={isCenterCopy ? undefined : true}
                      >
                        {EMOJIS.map((emoji) => {
                          const count = counts[emoji] ?? 0;
                          const voted = hasVoted(emoji);
                          const previewed = previewEmoji === emoji;
                          return (
                            <motion.button
                              key={`${copyIndex}-${emoji}`}
                              data-emoji={emoji}
                              variants={btnVariants}
                              className={`sparkline-reaction-btn sparkline-reaction-btn--portal${voted ? " sparkline-reaction-btn--active sparkline-reaction-btn--voted" : ""}${previewed ? " sparkline-reaction-btn--preview" : ""}`}
                              onClick={(event) => {
                                if (dragJustPlaced.current) {
                                  dragJustPlaced.current = false;
                                  if (suppressClickTimeout.current) {
                                    clearTimeout(suppressClickTimeout.current);
                                    suppressClickTimeout.current = null;
                                  }
                                  return;
                                }
                                const rect =
                                  event.currentTarget.getBoundingClientRect();
                                const { x, y } = resolveBurstCoordinates(
                                  event.detail,
                                  event.clientX,
                                  event.clientY,
                                  rect,
                                );
                                handleSelect(emoji, x, y);
                              }}
                              onPointerDown={(event) =>
                                handleEmojiPointerDown(event, emoji)
                              }
                              whileHover={
                                reduceMotion || voted
                                  ? undefined
                                  : { scale: 1.1 }
                              }
                              whileTap={
                                reduceMotion || voted
                                  ? undefined
                                  : { scale: 0.88 }
                              }
                              transition={{
                                type: "spring",
                                stiffness: 600,
                                damping: 22,
                              }}
                              tabIndex={isCenterCopy ? undefined : -1}
                              aria-label={
                                voted
                                  ? `${emoji} ${count} — your vote is active; tap to remove it`
                                  : `${emoji} ${count}`
                              }
                              aria-pressed={voted}
                              title={
                                voted
                                  ? "Your vote is active — tap to remove it"
                                  : onPlace
                                    ? "Tap to vote; swipe sideways to browse; drag out to place"
                                    : "Tap to vote; swipe sideways to browse on mobile portrait"
                              }
                            >
                              <span
                                className="sparkline-reaction-emoji"
                                style={{
                                  lineHeight: 1,
                                  display: "inline-block",
                                }}
                                aria-hidden="true"
                              >
                                {emoji}
                              </span>
                              {count > 0 && (
                                <span className="sparkline-reaction-count">
                                  {count}
                                </span>
                              )}
                            </motion.button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
