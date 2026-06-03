import { useState } from "react";
import type { PositionsResponse } from "@/lib/trading/types";
import { InlineState } from "@/components/trading-monitor/shared";

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
}: {
  error?: string | null;
}) {
  return (
    <div
      className="open-positions-panel trade-history-panel trade-history-panel--list-only"
      aria-label="Open positions"
    >
      {error ? (
        <InlineState
          tone="error"
          title="no data"
          message={error}
        />
      ) : null}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          marginTop: error ? '16px' : undefined,
        }}
      >
        <h3 style={{ margin: 0 }}>วิเคราะห์ทางเทคนิค</h3>
        <span style={{color: "gold", gridAutoFlow: "column",opacity: 0.6 }}>XAUUSD</span>
      </div>
    </div>
  );
}

export function OpenPositionsPanel({
  positions,
  loading,
  error,
  onOpenTechnicalAnalysis,
}: {
  positions: PositionsResponse["openPositions"] | null | undefined;
  loading: boolean;
  error: string | null | undefined;
  onOpenTechnicalAnalysis?: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const rankedPositions = rankOpenPositions(positions);

  if (loading && !rankedPositions.length) {
    return <div className="skeleton-chart account-card__chart-skeleton" aria-hidden="true" />;
  }

  if (error && !rankedPositions.length) {
    return (
      <EmptyOpenPositionsState
        error={error}
      />
    );
  }

  return (
    <div
      className={`open-positions-panel trade-history-panel trade-history-panel--list-only${onOpenTechnicalAnalysis ? " open-positions-panel--interactive" : ""}`}
      aria-label="Open positions"
      onClick={onOpenTechnicalAnalysis}
    >
      { !rankedPositions.length ? (
          <EmptyOpenPositionsState
          />
        ) : (
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

              return (
                <div key={position.positionId} className={`trade-history-row ${isExpanded ? "is-expanded" : ""}`}>
                  <button
                    className="open-positions-panel__summary trade-history-row__summary"
                    onClick={(event) => {
                      event.stopPropagation();
                      setExpandedId(isExpanded ? null : (position.positionId as string));
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
                  </button>

                  {isExpanded ? (
                    <div className="trade-history-row__details">
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
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )
      }
    </div>
  );
}
