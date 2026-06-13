import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { PositionsResponse } from "@/lib/trading/types";

import {
  formatPlainNumberValue,
  formatPositionSide,
  formatSignedPlainAmountKpiValue,
  formatTradePrice,
  formatTradeHistoryDateTime,
  getPnlToneClass,
  getSideToneClass,
  positionHistoryNetPnl,
} from "@/components/trading-monitor/DashboardFormatters";

export function TradeHistoryPanel({
  positions,
}: {
  positions: PositionsResponse["historyPositions"] | null | undefined;
}) {
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const historyPositions = useMemo(
    () =>
      [...(positions ?? [])].sort(
        (l, r) => new Date(r.closedAt ?? 0).getTime() - new Date(l.closedAt ?? 0).getTime(),
      ),
    [positions],
  );
  const displayedPositions = historyPositions.slice(0, 150);

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
                whileTap={{ scale: 0.99 }}
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
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    className="trade-history-row__details trade-history-row__details--2col"
                    style={{ overflow: "hidden" }}
                  >
                    <div className="trade-history-row__detail">
                      <span className="trade-history-row__label">∆pip</span>
                      <span className={`trade-history-row__val ${position.pips != null ? getPnlToneClass(position.pips) : ""}`}>{position.pips != null ? formatPlainNumberValue(position.pips, 1) : "—"}</span>
                    </div>
                    <div className="trade-history-row__detail trade-history-row__detail--val-only">
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
                    {position.comment ? (
                      <div className="trade-history-row__detail trade-history-row__detail--full trade-history-row__detail--comment">
                        <span className="trade-history-row__label">Comment</span>
                        <span className="trade-history-row__val trade-history-row__val--comment">{position.comment}</span>
                      </div>
                    ) : null}
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
