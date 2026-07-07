import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { expandRow, tapRow } from "@/lib/animations";
import type { PositionsResponse } from "@/lib/trading/types";

import {
  formatPlainNumberValue,
  formatPositionSide,
  formatSignedPlainAmountKpiValue,
  formatTradeExitReason,
  formatTradePrice,
  formatTradeHistoryDateTime,
  getPnlToneClass,
  getSideToneClass,
  getTradeExitToneClass,
  positionHistoryNetPnl,
} from "@/components/trading-monitor/dashboardFormatters";

const INITIAL_VISIBLE_TRADES = 150;
const VISIBLE_TRADES_INCREMENT = 150;

export function TradeHistoryPanel({
  positions,
}: {
  positions: PositionsResponse["historyPositions"] | null | undefined;
}) {
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_TRADES);
  const historyPositions = useMemo(
    () =>
      [...(positions ?? [])].sort(
        (l, r) => new Date(r.closedAt ?? 0).getTime() - new Date(l.closedAt ?? 0).getTime(),
      ),
    [positions],
  );
  const displayedPositions = historyPositions.slice(0, visibleCount);
  const hiddenCount = Math.max(0, historyPositions.length - displayedPositions.length);

  useEffect(() => {
    setExpandedRowKey(null);
    setVisibleCount(INITIAL_VISIBLE_TRADES);
  }, [positions]);

  if (!historyPositions.length) {
    return (
      <div className="trade-history-panel trade-history-panel--list-only" aria-label="Trades list">
        <div className="trade-history-empty">No trade history</div>
      </div>
    );
  }

  return (
    <div className="trade-history-panel trade-history-panel--list-only" aria-label="Trades list">
      <div className="trade-history-panel__list">
        {displayedPositions.map((position) => {
          const rowKey = position.positionId || `${position.symbol}-${position.closedAt}-${position.volume}`;
          const isExpanded = expandedRowKey === rowKey;
          const sideLabel = formatPositionSide(position.type);
          const volumeLabel = formatPlainNumberValue(position.volume, 2);
          const rowNetPnl = positionHistoryNetPnl(position);
          const sideToneClass = getSideToneClass(sideLabel);
          const pnlToneClass = getPnlToneClass(rowNetPnl);

          return (
            <div key={rowKey} className={isExpanded ? "trade-history-row is-expanded" : "trade-history-row"}>
              <motion.button
                {...tapRow}
                type="button"
                className="trade-history-row__summary"
                aria-expanded={isExpanded}
                onClick={() => setExpandedRowKey((current) => (current === rowKey ? null : rowKey))}
              >
                <div className="trade-history-row__line">
                  <div className="trade-history-row__instrument">
                    <strong>{position.symbol}</strong>
                    <span className={`trade-history-row__side ${sideToneClass}`}>{sideLabel}</span>
                    <span className={`trade-history-row__volume ${sideToneClass}`}>{volumeLabel}</span>
                  </div>
                  <div className={`trade-history-row__trail ${pnlToneClass}`}>
                    <strong>{formatSignedPlainAmountKpiValue(rowNetPnl, 2)}</strong>
                  </div>
                </div>
                <div className="trade-history-row__line trade-history-row__line--secondary">
                  <div className="trade-history-row__prices">
                    <span>{`${formatTradePrice(position.openPrice)} -> ${formatTradePrice(position.closePrice)}`}</span>
                  </div>
                  <div className="trade-history-row__trail trade-history-row__trail--secondary">
                    <span>{formatTradeHistoryDateTime(position.closedAt)}</span>
                  </div>
                </div>
              </motion.button>
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    {...expandRow}
                    className="trade-history-row__details trade-history-row__details--2col"
                  >
                    <div className="trade-history-row__detail">
                      <span className="trade-history-row__label">∆pip</span>
                      <span className={`trade-history-row__val ${position.pips != null ? getPnlToneClass(position.pips) : ""}`}>{position.pips != null ? formatPlainNumberValue(position.pips, 1) : "—"}</span>
                    </div>
                    <div className="trade-history-row__detail">
                      <span className="trade-history-row__label">Open</span>
                      <span className="trade-history-row__val">{formatTradeHistoryDateTime(position.openedAt)}</span>
                    </div>

                    <div className="trade-history-row__detail">
                      <span className="trade-history-row__label">S/L</span>
                      <span className={`trade-history-row__val ${position.slHit ? "trade-history-row__val--sl-hit" : "trade-history-row__val--white"}`}>{formatTradePrice(position.sl)}</span>
                    </div>
                    <div className="trade-history-row__detail">
                      <span className="trade-history-row__label">Swap</span>
                      <span className="trade-history-row__val trade-history-row__val--white">{formatSignedPlainAmountKpiValue(position.swap, 1)}</span>
                    </div>

                    <div className="trade-history-row__detail">
                      <span className="trade-history-row__label">T/P</span>
                      <span className={`trade-history-row__val ${position.tpHit ? "trade-history-row__val--tp-hit" : "trade-history-row__val--white"}`}>{formatTradePrice(position.tp)}</span>
                    </div>
                    <div className="trade-history-row__detail">
                      <span className="trade-history-row__label">Charges</span>
                      <span className="trade-history-row__val trade-history-row__val--white">{formatSignedPlainAmountKpiValue(position.commission, 1)}</span>
                    </div>

                    <div className="trade-history-row__detail">
                      <span className="trade-history-row__label">Reason</span>
                      <span className={`trade-history-row__val ${getTradeExitToneClass(position)}`}>{formatTradeExitReason(position)}</span>
                    </div>
                    <div className="trade-history-row__detail trade-history-row__detail--comment">
                      <span className="trade-history-row__label">Comment</span>
                      <span className="trade-history-row__val trade-history-row__val--comment" title={position.comment || undefined}>{position.comment?.trim() || "-"}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
        {hiddenCount > 0 ? (
          <button
            type="button"
            className="trade-history-panel__load-more"
            onClick={() => setVisibleCount((current) => Math.min(current + VISIBLE_TRADES_INCREMENT, historyPositions.length))}
          >
            <span>{displayedPositions.length} / {historyPositions.length}</span>
            <strong>Load more</strong>
          </button>
        ) : null}
      </div>
    </div>
  );
}
