"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
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
  const [cardPos, setCardPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const content = normalizeKpiHint(hint);

  const computeCardPos = useCallback(() => {
    if (!triggerRef?.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const HALF = 150;
    const PADDING = 12;
    const left = Math.max(HALF + PADDING, Math.min(cx, window.innerWidth - HALF - PADDING));
    if (rect.top < window.innerHeight / 2) {
      setCardPos({ left, top: rect.bottom + 8 });
    } else {
      setCardPos({ left, bottom: window.innerHeight - rect.top + 8 });
    }
  }, [triggerRef]);

  useEffect(() => {
    computeCardPos();
    window.addEventListener("resize", computeCardPos);
    return () => window.removeEventListener("resize", computeCardPos);
  }, [computeCardPos]);

  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  };

  const cardVariants = reduceMotion
    ? { hidden: { opacity: 0 }, visible: { opacity: 1 } }
    : {
        hidden: { opacity: 0, scale: 0.93, y: 4 },
        visible: { opacity: 1, scale: 1, y: 0 },
      };

  return createPortal(
    <motion.div
      className="kpi-card-backdrop"
      variants={backdropVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
      transition={{ duration: 0.16 }}
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      aria-label={`${label} — คำอธิบาย`}
    >
      <motion.div
        ref={cardRef}
        className="kpi-card"
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        exit="hidden"
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        style={cardPos ? {
          left: `${cardPos.left}px`,
          ...(cardPos.top !== undefined ? { top: `${cardPos.top}px` } : { bottom: `${cardPos.bottom}px` }),
        } : undefined}
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
    try { navigator.vibrate?.(12); } catch { /* ignore */ }
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

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!hasHint) return;
    clearLongPress();

    if (longPressTriggeredRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }

    window.setTimeout(() => {
      longPressTriggeredRef.current = false;
    }, 0);
  }, [clearLongPress, hasHint]);

  function wrapClick(onClick?: () => void) {
    return (e: React.MouseEvent) => {
      if (hasHint && longPressTriggeredRef.current) {
        e.preventDefault();
        e.stopPropagation();
        longPressTriggeredRef.current = false;
        return;
      }
      onClick?.();
    };
  }

  return {
    chipRef,
    sheetOpen,
    closeSheet,
    handleTouchStart,
    handleTouchMove,
    handleTouchCancel,
    handleTouchEnd,
    wrapClick,
  };
}

// ── SummaryChip ───────────────────────────────────────────────
export function SummaryChip({
  label,
  value,
  tone = "neutral",
  meta,
  fullValue,
  hint,
  onClick,
  isSelected = false,
}: {
  label: string;
  value: string;
  tone?: MetricTone;
  meta?: string;
  fullValue?: string;
  hint?: string | KpiHintContent;
  onClick?: () => void;
  isSelected?: boolean;
}) {
  const { chipRef, sheetOpen, closeSheet, handleTouchStart, handleTouchMove, handleTouchCancel, handleTouchEnd, wrapClick } =
    useKpiHint(Boolean(hint));

  const tooltip = fullValue ? `${label}: ${fullValue}` : undefined;
  const interactive = Boolean(onClick);
  const className =
    `kchip ${interactive ? "is-actionable" : "is-static"} ${isSelected ? "is-selected" : ""} ${hint ? "has-hint" : ""}`.trim();

  const inner = (
    <>
      <span className="kl">
        {label}
        {hint ? (
          <span
            className="kchip__hint-badge"
            aria-label="ดูคำอธิบาย"
          >?</span>
        ) : null}
      </span>
      <strong className={`kv tone-${tone}`}>{value}</strong>
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

  const tapProps = interactive || hint ? {
    whileTap: { scale: 0.96 },
    transition: { type: "spring" as const, stiffness: 400, damping: 17 }
  } : {};

  if (!interactive) {
    return (
      <motion.div
        ref={chipRef as React.RefObject<HTMLDivElement>}
        className={className}
        title={tooltip}
        aria-label={tooltip}
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
}
