import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { PositionsResponse } from "@/lib/trading/types";
import { InlineState } from "@/components/trading-monitor/shared";
import { EconomicCalendarList } from "@/components/trading-monitor/EconomicCalendarList";

import {
  formatPlainNumberValue,
  formatPositionSide,
  formatSignedPlainAmountKpiValue,
  formatTradeHistoryDateTime,
  formatTradePrice,
  getPnlToneClass,
  getSideToneClass,
} from "@/components/trading-monitor/DashboardFormatters";

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
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const [timelineHeight, setTimelineHeight] = useState<number | null>(null);

  useEffect(() => {
    if (timelineRef.current) setTimelineHeight(timelineRef.current.offsetHeight);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startY: e.clientY,
      startH: timelineRef.current?.offsetHeight ?? (timelineHeight ?? 200),
    };
  }, [timelineHeight]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const delta = dragRef.current.startY - e.clientY;
    setTimelineHeight(Math.max(60, Math.min(560, dragRef.current.startH + delta)));
  }, []);

  const onPointerUp = useCallback(() => { dragRef.current = null; }, []);

  const timelineStyle: React.CSSProperties | undefined = timelineHeight !== null
    ? { height: timelineHeight, flex: "none" }
    : undefined;

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
          ref={timelineRef}
          className="open-positions-empty__timeline"
          aria-label="Economic Events"
          style={timelineStyle}
        >
          <div
            className="open-positions-empty__grab-handle"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            role="separator"
            aria-label="ลากเพื่อปรับขนาด"
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
          const sideLabel = formatPositionSide(position.side);
          const sideToneClass = getSideToneClass(sideLabel);
          const comment = position.comment?.trim() || "-";
          const volumeLabel = formatPlainNumberValue(position.volume, 2);
          const priceRangeLabel = `${formatTradePrice(position.openPrice)} -> ${formatTradePrice(position.marketPrice)}`;
          const stopLossLabel = formatStopTargetPrice(position.sl);
          const takeProfitLabel = formatStopTargetPrice(position.tp);
          const pnlToneClass = getPnlToneClass(position.floatingProfit ?? 0);
          const isExpanded = expandedId === position.positionId;
          const positionId = String(position.positionId);

          return (
            <div key={positionId} className={`trade-history-row ${isExpanded ? "is-expanded" : ""}`}>
              <motion.button
                whileTap={{ scale: 0.99 }}
                type="button"
                className="open-positions-panel__summary trade-history-row__summary"
                onClick={(event) => {
                  event.stopPropagation();
                  setExpandedId(isExpanded ? null : positionId);
                }}
                aria-expanded={isExpanded}
              >
                <div className="trade-history-row__line">
                  <div className="trade-history-row__instrument">
                    <strong>{position.symbol}</strong>
                    <span className={`trade-history-row__side ${sideToneClass}`}>{sideLabel}</span>
                    <span className={`trade-history-row__volume ${sideToneClass}`}>{volumeLabel}</span>
                  </div>
                  <div className={`trade-history-row__trail ${pnlToneClass}`}>
                    <strong>{formatSignedPlainAmountKpiValue(position.floatingProfit)}</strong>
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
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className="trade-history-row__details"
                    style={{ overflow: "hidden" }}
                  >
                    <div className="trade-history-row__detail">
                      <span className="trade-history-row__label">S/L</span>
                      <span className="trade-history-row__val">{stopLossLabel}</span>
                    </div>
                    <div className="trade-history-row__detail trade-history-row__detail--val-only">
                      <span className="trade-history-row__val trade-history-row__val--comment">{comment}</span>
                    </div>
                    <div className="trade-history-row__detail">
                      <span className="trade-history-row__label">T/P</span>
                      <span className="trade-history-row__val">{takeProfitLabel}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
