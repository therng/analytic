"use client";

import { memo, useRef, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  kpiCardBackdropVariants,
  kpiCardVariants,
  kpiCardTransition,
  tapChip,
} from "@/lib/animations";
import { type MetricTone } from "@/components/trading-monitor/formatters";

export type KpiHintContent = {
  definition: string;
};

function normalizeKpiHint(hint: string | KpiHintContent): KpiHintContent {
  if (typeof hint === "string") {
    return { definition: hint };
  }

  return hint;
}

// ── KPI Preview Card ──────────────────────────────────────────
export function KpiPreviewCard({
  hint,
  label,
  onClose,
  triggerRef,
}: {
  hint: string | KpiHintContent;
  label: string;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}) {
  const [cardPos, setCardPos] = useState<{
    left: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const content = normalizeKpiHint(hint);

  const computeCardPos = useCallback(() => {
    if (!triggerRef?.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const HALF = 150;
    const PADDING = 12;
    const left = Math.max(
      HALF + PADDING,
      Math.min(cx, window.innerWidth - HALF - PADDING),
    );
    if (rect.top < window.innerHeight / 2) {
      setCardPos({ left, top: rect.bottom + 8 });
    } else {
      setCardPos({ left, bottom: window.innerHeight - rect.top + 8 });
    }
  }, [triggerRef]);

  useEffect(() => {
    computeCardPos();
    window.addEventListener("resize", computeCardPos);
    window.addEventListener("scroll", computeCardPos, {
      passive: true,
      capture: true,
    });
    return () => {
      window.removeEventListener("resize", computeCardPos);
      window.removeEventListener("scroll", computeCardPos, { capture: true });
    };
  }, [computeCardPos]);

  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Trap focus inside the card — only the card div is focusable here
      if (e.key === "Tab") {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const cardVariants = kpiCardVariants(Boolean(reduceMotion));
  const placement = cardPos?.top !== undefined ? "below" : "above";

  return createPortal(
    <motion.div
      className="kpi-card-backdrop"
      variants={kpiCardBackdropVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
      transition={{ duration: 0.16 }}
      onClick={onClose}
    >
      <motion.div
        ref={cardRef}
        className="kpi-card"
        role="dialog"
        aria-modal="true"
        aria-label={`${label} — คำอธิบาย`}
        data-placement={cardPos ? placement : undefined}
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        exit="hidden"
        transition={kpiCardTransition}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        style={
          cardPos
            ? {
                x: "-50%",
                left: `${cardPos.left}px`,
                ...(cardPos.top !== undefined
                  ? { top: `${cardPos.top}px` }
                  : { bottom: `${cardPos.bottom}px` }),
              }
            : undefined
        }
      >
        <p className="kpi-card__body-definition">{content.definition}</p>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

// ── Hook ──────────────────────────────────────────────────────
export function useKpiHint(hasHint: boolean) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const chipRef = useRef<HTMLElement | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const longPressTriggeredRef = useRef(false);

  useEffect(() => {
    return () => {
      clearTimeout(longPressTimer.current);
      longPressTriggeredRef.current = false;
    };
  }, []);

  const openSheet = useCallback(() => {
    try {
      navigator.vibrate?.(12);
    } catch {
      /* ignore */
    }
    setSheetOpen(true);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
  }, []);

  const clearLongPress = useCallback(() => {
    clearTimeout(longPressTimer.current);
    longPressTimer.current = undefined;
  }, []);

  const handleTouchStart = useCallback(() => {
    if (!hasHint) return;
    longPressTriggeredRef.current = false;
    clearLongPress();
    longPressTimer.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      openSheet();
    }, 500);
  }, [clearLongPress, hasHint, openSheet]);

  const handleTouchMove = useCallback(() => {
    if (!hasHint) return;
    clearLongPress();
  }, [clearLongPress, hasHint]);

  const handleTouchCancel = useCallback(() => {
    if (!hasHint) return;
    clearLongPress();
  }, [clearLongPress, hasHint]);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!hasHint) return;
      clearLongPress();

      if (longPressTriggeredRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }

      setTimeout(() => {
        longPressTriggeredRef.current = false;
      }, 0);
    },
    [clearLongPress, hasHint],
  );

  const wrapClick = useCallback(
    (onClick?: () => void) => {
      return (e: React.MouseEvent) => {
        if (hasHint && longPressTriggeredRef.current) {
          e.preventDefault();
          e.stopPropagation();
          longPressTriggeredRef.current = false;
          return;
        }
        onClick?.();
      };
    },
    [hasHint],
  );

  return {
    chipRef,
    sheetOpen,
    openSheet,
    closeSheet,
    handleTouchStart,
    handleTouchMove,
    handleTouchCancel,
    handleTouchEnd,
    wrapClick,
  };
}

// ── SummaryChip ───────────────────────────────────────────────
export const SummaryChip = memo(function SummaryChip({
  label,
  value,
  tone = "neutral",
  meta,
  fullValue,
  hint,
  onClick,
  isSelected = false,
  flashClass,
  chipClassName,
}: {
  label: string;
  value: string;
  tone?: MetricTone;
  meta?: string;
  fullValue?: string;
  hint?: string | KpiHintContent;
  onClick?: () => void;
  isSelected?: boolean;
  flashClass?: string;
  /** Optional semantic modifier for KPI-grid states such as `kchip--critical`. */
  chipClassName?: string;
}) {
  const {
    chipRef,
    sheetOpen,
    openSheet,
    closeSheet,
    handleTouchStart,
    handleTouchMove,
    handleTouchCancel,
    handleTouchEnd,
    wrapClick,
  } = useKpiHint(Boolean(hint));

  const tooltip = fullValue ? `${label}: ${fullValue}` : undefined;
  const interactive = Boolean(onClick);
  const className = [
    "kchip",
    interactive ? "is-actionable" : "is-static",
    isSelected && "is-selected",
    hint && "has-hint",
    chipClassName,
  ]
    .filter(Boolean)
    .join(" ");

  const inner = (
    <>
      <span className="kl">
        {label}
        {hint ? (
          <span className="kchip__hint-badge" aria-label="ดูคำอธิบาย">
            ?
          </span>
        ) : null}
      </span>
      <strong
        className={`kv tone-${tone}${flashClass ? ` ${flashClass}` : ""}`}
      >
        {value}
      </strong>
      {meta ? <span className="kchip__meta">{meta}</span> : null}

      {/* Preview Card (tap/long-press) */}
      <AnimatePresence>
        {hint && sheetOpen ? (
          <KpiPreviewCard
            hint={hint}
            label={label}
            onClose={closeSheet}
            triggerRef={chipRef}
          />
        ) : null}
      </AnimatePresence>
    </>
  );

  const tapProps = interactive || hint ? tapChip : {};

  if (!interactive) {
    // Non-interactive chip with hint: expose as button for keyboard + screen reader access
    if (hint) {
      return (
        <motion.div
          ref={chipRef as React.RefObject<HTMLDivElement>}
          className={className}
          title={tooltip}
          role="button"
          tabIndex={0}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchCancel={handleTouchCancel}
          onTouchEnd={handleTouchEnd}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openSheet();
            }
          }}
          {...tapProps}
        >
          {inner}
        </motion.div>
      );
    }

    return (
      <motion.div
        ref={chipRef as React.RefObject<HTMLDivElement>}
        className={className}
        title={tooltip}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchCancel={handleTouchCancel}
        onTouchEnd={handleTouchEnd}
        {...tapProps}
      >
        {inner}
      </motion.div>
    );
  }

  return (
    <motion.button
      ref={chipRef as React.RefObject<HTMLButtonElement>}
      type="button"
      className={className}
      title={tooltip}
      aria-label={tooltip}
      aria-pressed={isSelected}
      aria-haspopup={hint ? "dialog" : undefined}
      onClick={wrapClick(onClick)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchCancel={handleTouchCancel}
      onTouchEnd={handleTouchEnd}
      {...tapProps}
    >
      {inner}
    </motion.button>
  );
});
