import { useEffect, useState } from "react";
import { motion, AnimatePresence, useDragControls, useMotionValue } from "framer-motion";
import { expandRow, tapRow, backdrop, calendarSheet } from "@/lib/animations";
import type { PositionsResponse, SerializedOpenPosition } from "@/lib/trading/types";
import { InlineState } from "@/components/trading-monitor/MonitorShared";
import { EconomicCalendarList } from "@/components/trading-monitor/EconomicCalendarList";
import { useValueFlash } from "@/hooks/useValueFlash";

import {
  formatMagicNumber,
  formatPlainNumberValue,
  formatPositionSide,
  formatSignedPlainAmountKpiValue,
  formatTradeHistoryDateTime,
  formatTradePrice,
  getPnlToneClass,
  getSideToneClass,
} from "@/components/trading-monitor/dashboardFormatters";

function rankOpenPositions(positions: PositionsResponse["openPositions"] | null | undefined) {
  return [...(positions ?? [])].sort((left, right) => {
    const profitDelta = Math.abs(Number(right.floatingProfit ?? 0)) - Math.abs(Number(left.floatingProfit ?? 0));
    if (profitDelta !== 0) {
      return profitDelta;
    }

    return Number(right.volume ?? 0) - Number(left.volume ?? 0);
  });
}

function formatStopTargetPrice(value: number | null | undefined) {
  return Number.isFinite(value) ? formatTradePrice(value) : "-";
}

function EmptyOpenPositionsState({
  error,
  onOpenTechnicalAnalysis,
}: {
  error?: string | null;
  onOpenTechnicalAnalysis?: () => void;
}) {
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const dragControls = useDragControls();
  const dragY = useMotionValue(0);

  useEffect(() => {
    if (!calendarExpanded) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCalendarExpanded(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [calendarExpanded]);

  return (
    <div
      className="open-positions-panel open-positions-panel--empty trade-history-panel trade-history-panel--list-only"
      aria-label="Open positions"
    >
      {error ? (
        <InlineState tone="error" title="no data" message={error} />
      ) : null}

      <div className="open-positions-empty">
        <button
          type="button"
          className="open-positions-empty__cta"
          onClick={onOpenTechnicalAnalysis}
          disabled={!onOpenTechnicalAnalysis}
        >
          <span className="open-positions-empty__cta-title">วิเคราะห์ทางเทคนิค</span>
          <span className="open-positions-empty__cta-symbol">XAUUSD</span>
        </button>

        <div
          className="open-positions-empty__timeline"
          aria-label="Economic Events"
        >
          <button
            type="button"
            className="open-positions-empty__grab-handle"
            aria-label="Expand economic calendar"
            onClick={() => setCalendarExpanded(true)}
          />
          <div className="eco-cal">
            <div className="eco-cal__header">
              <span className="eco-cal__title">Economic Calendar</span>
              <span className="eco-cal__subtitle">US · High Impact</span>
            </div>
            <EconomicCalendarList />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {calendarExpanded ? (
          <motion.div
            className="open-positions-calendar-sheet-backdrop"
            {...backdrop}
            onClick={() => setCalendarExpanded(false)}
          >
            <motion.div
              className="open-positions-calendar-sheet sp-draggable-panel"
              role="dialog"
              aria-modal="true"
              aria-label="Economic calendar"
              {...calendarSheet}
              drag="y"
              dragControls={dragControls}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.28 }}
              style={{ y: dragY }}
              onDragEnd={(_, info) => {
                if (info.offset.y > 80 || info.velocity.y > 500) {
                  setCalendarExpanded(false);
                } else {
                  dragY.set(0);
                }
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="sp-draggable-panel__handle"
                aria-label="Drag to collapse economic calendar"
                onPointerDown={(event) => dragControls.start(event)}
                onClick={() => setCalendarExpanded(false)}
              />
              <div className="eco-cal">
                <div className="eco-cal__header">
                  <span className="eco-cal__title">Economic Calendar</span>
                  <span className="eco-cal__subtitle">US · High Impact</span>
                </div>
                <EconomicCalendarList />
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function OpenPositionRow({
  position,
  isExpanded,
  onToggle,
}: {
  position: SerializedOpenPosition;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const sideLabel = formatPositionSide(position.side);
  const sideToneClass = getSideToneClass(sideLabel);
  const comment = position.comment?.trim() || "-";
  const volumeLabel = formatPlainNumberValue(position.volume, 2);
  const priceRangeLabel = `${formatTradePrice(position.openPrice)} -> ${formatTradePrice(position.marketPrice)}`;
  const stopLossLabel = formatStopTargetPrice(position.sl);
  const takeProfitLabel = formatStopTargetPrice(position.tp);
  const pnlToneClass = getPnlToneClass(position.floatingProfit ?? 0);
  const profitFlashClass = useValueFlash(position.floatingProfit ?? 0);

  return (
    <div className={`trade-history-row ${isExpanded ? "is-expanded" : ""}`}>
      <motion.button
        {...tapRow}
        type="button"
        className="open-positions-panel__summary trade-history-row__summary"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        aria-expanded={isExpanded}
      >
        <div className="trade-history-row__line">
          <div className="trade-history-row__instrument">
            <strong>{position.symbol}</strong>
            <span className={`trade-history-row__side ${sideToneClass}`}>{sideLabel}</span>
            <span className={`trade-history-row__volume ${sideToneClass}`}>{volumeLabel}</span>
          </div>
          <div className={`trade-history-row__trail ${pnlToneClass}`}>
            <strong className={profitFlashClass || undefined}>
              {formatSignedPlainAmountKpiValue(position.floatingProfit)}
            </strong>
          </div>
        </div>
        <div className="trade-history-row__line trade-history-row__line--secondary">
          <div className="trade-history-row__prices">
            <span>{priceRangeLabel}</span>
          </div>
          <div className="trade-history-row__trail trade-history-row__trail--secondary">
            <span>{formatTradeHistoryDateTime(position.openedAt)}</span>
          </div>
        </div>
      </motion.button>
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            {...expandRow}
            className="trade-history-row__details"
            aria-live="polite"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="trade-history-row__detail">
              <span className="trade-history-row__label">S/L</span>
              <span className="trade-history-row__val">{stopLossLabel}</span>
            </div>
            <div className="trade-history-row__detail">
              <span className="trade-history-row__label">Swap</span>
              <span className="trade-history-row__val trade-history-row__val--white">{formatSignedPlainAmountKpiValue(position.swap, 1)}</span>
            </div>
            <div className="trade-history-row__detail">
              <span className="trade-history-row__label">T/P</span>
              <span className="trade-history-row__val">{takeProfitLabel}</span>
            </div>
            <div className="trade-history-row__detail">
              <span className="trade-history-row__label">Magic</span>
              <span className="trade-history-row__val trade-history-row__val--white">{formatMagicNumber(position.magic)}</span>
            </div>
            {comment !== "-" && (
              <div className="trade-history-row__detail trade-history-row__detail--full">
                <span className="trade-history-row__val trade-history-row__val--comment">{comment}</span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function OpenPositionsPanel({
  positions,
  loading,
  error,
  onOpenTechnicalAnalysis,
  compact,
}: {
  positions: PositionsResponse["openPositions"] | null | undefined;
  loading: boolean;
  error: string | null | undefined;
  onOpenTechnicalAnalysis?: () => void;
  /** When true, suppresses the news/calendar empty state (used in desktop layout) */
  compact?: boolean;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const rankedPositions = rankOpenPositions(positions);

  if (loading && !rankedPositions.length) {
    return <div className="skeleton-chart account-card__chart-skeleton" aria-hidden="true" />;
  }

  if (!rankedPositions.length) {
    if (compact) {
      if (error) {
        return (
          <div className="dc-empty-state" style={{ color: "var(--tone-negative)" }}>
            <span>{error}</span>
          </div>
        );
      }
      return null;
    }
    return (
      <EmptyOpenPositionsState
        error={error}
        onOpenTechnicalAnalysis={onOpenTechnicalAnalysis}
      />
    );
  }

  return (
    <div
      className={`open-positions-panel trade-history-panel trade-history-panel--list-only${onOpenTechnicalAnalysis ? " open-positions-panel--interactive" : ""}`}
      aria-label="Open positions"
      onClick={onOpenTechnicalAnalysis ?? undefined}
    >
      <div className="trade-history-panel__list">
        {rankedPositions.map((position) => {
          const positionId = String(position.positionId);
          const isExpanded = expandedId === positionId;
          return (
            <OpenPositionRow
              key={positionId}
              position={position}
              isExpanded={isExpanded}
              onToggle={() => {
                setExpandedId(isExpanded ? null : positionId);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
