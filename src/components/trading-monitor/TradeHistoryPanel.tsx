import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { expandRow, tapRow } from "@/lib/animations";
import type { PositionsResponse } from "@/lib/trading/types";

import {
  formatPlainNumberValue,
  formatPositionSide,
  formatSignedPlainAmountKpiValue,
  formatTradeComment,
  formatTradePrice,
  formatTradeHistoryDateTime,
  getPnlToneClass,
  getSideToneClass,
  positionHistoryNetPnl,
} from "@/components/trading-monitor/dashboardFormatters";

const PAGE_LIMIT = 150;

type HistoryPosition = PositionsResponse["historyPositions"][number];

export function TradeHistoryPanel({
  accountId,
  timeframe,
}: {
  accountId: string;
  timeframe: string;
}) {
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const [rows, setRows] = useState<HistoryPosition[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestIdRef = useRef(0);

  const fetchPage = useCallback(
    (cursor: string | null, requestId: number) => {
      const params = new URLSearchParams({
        timeframe,
        limit: String(PAGE_LIMIT),
      });
      if (cursor) params.set("cursor", cursor);

      return fetch(`/api/accounts/${accountId}/positions?${params}`, {
        cache: "no-store",
      })
        .then((response) => response.json())
        .then((data: PositionsResponse) => {
          if (requestIdRef.current !== requestId) return;
          setRows((current) =>
            cursor
              ? [...current, ...data.historyPositions]
              : data.historyPositions,
          );
          setNextCursor(data.historyPage?.nextCursor ?? null);
        });
    },
    [accountId, timeframe],
  );

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setExpandedRowKey(null);
    fetchPage(null, requestId).finally(() => {
      if (requestIdRef.current === requestId) setLoading(false);
    });
  }, [fetchPage]);

  const handleLoadMore = () => {
    if (!nextCursor || loadingMore) return;
    const requestId = requestIdRef.current;
    setLoadingMore(true);
    fetchPage(nextCursor, requestId).finally(() => setLoadingMore(false));
  };

  if (!loading && !rows.length) {
    return (
      <div
        className="trade-history-panel trade-history-panel--list-only"
        aria-label="Trades list"
      >
        <div className="trade-history-empty">No trade history</div>
      </div>
    );
  }

  return (
    <div
      className="trade-history-panel trade-history-panel--list-only"
      aria-label="Trades list"
    >
      <div className="trade-history-panel__list">
        {rows.map((position) => {
          const rowKey =
            position.positionId ||
            `${position.symbol}-${position.closedAt}-${position.volume}`;
          const isExpanded = expandedRowKey === rowKey;
          const sideLabel = formatPositionSide(position.type);
          const volumeLabel = formatPlainNumberValue(position.volume, 2);
          const rowNetPnl = positionHistoryNetPnl(position);
          const sideToneClass = getSideToneClass(sideLabel);
          const pnlToneClass = getPnlToneClass(rowNetPnl);

          return (
            <div
              key={rowKey}
              className={
                isExpanded
                  ? "trade-history-row is-expanded"
                  : "trade-history-row"
              }
            >
              <motion.button
                {...tapRow}
                type="button"
                className="trade-history-row__summary"
                aria-expanded={isExpanded}
                onClick={() =>
                  setExpandedRowKey((current) =>
                    current === rowKey ? null : rowKey,
                  )
                }
              >
                <div className="trade-history-row__line">
                  <div className="trade-history-row__instrument">
                    <strong>{position.symbol}</strong>
                    <span
                      className={`trade-history-row__side ${sideToneClass}`}
                    >
                      {sideLabel}
                    </span>
                    <span
                      className={`trade-history-row__volume ${sideToneClass}`}
                    >
                      {volumeLabel}
                    </span>
                  </div>
                  <div className={`trade-history-row__trail ${pnlToneClass}`}>
                    <strong>
                      {formatSignedPlainAmountKpiValue(rowNetPnl, 2)}
                    </strong>
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
                    <div className="trade-history-row__detail trade-history-row__detail--full">
                      <span className="trade-history-row__label">∆pips</span>
                      <span
                        className={`trade-history-row__val ${position.pips != null ? getPnlToneClass(position.pips) : ""}`}
                      >
                        {position.pips != null
                          ? formatPlainNumberValue(position.pips, 1)
                          : "—"}
                      </span>
                      <span className="trade-history-row__val trade-history-row__val--white">
                        {formatTradeHistoryDateTime(position.openedAt)}
                      </span>
                    </div>

                    <div className="trade-history-row__detail">
                      <span className="trade-history-row__label">S/L</span>
                      <span
                        className={`trade-history-row__val ${position.slHit ? "trade-history-row__val--sl-hit" : "trade-history-row__val--white"}`}
                      >
                        {formatTradePrice(position.sl)}
                      </span>
                    </div>
                    <div className="trade-history-row__detail">
                      <span className="trade-history-row__label">Swap</span>
                      <span className="trade-history-row__val trade-history-row__val--white">
                        {formatSignedPlainAmountKpiValue(position.swap, 1)}
                      </span>
                    </div>

                    <div className="trade-history-row__detail">
                      <span className="trade-history-row__label">T/P</span>
                      <span
                        className={`trade-history-row__val ${position.tpHit ? "trade-history-row__val--tp-hit" : "trade-history-row__val--white"}`}
                      >
                        {formatTradePrice(position.tp)}
                      </span>
                    </div>
                    <div className="trade-history-row__detail">
                      <span className="trade-history-row__label">Charges</span>
                      <span className="trade-history-row__val trade-history-row__val--white">
                        {formatSignedPlainAmountKpiValue(
                          position.commission,
                          1,
                        )}
                      </span>
                    </div>

                    <div className="trade-history-row__detail trade-history-row__detail--comment">
                      <span className="trade-history-row__label">Comment</span>
                      <span
                        className="trade-history-row__val trade-history-row__val--comment"
                        title={formatTradeComment(
                          position.comment,
                          position.magic,
                        )}
                      >
                        {formatTradeComment(position.comment, position.magic)}
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
        {nextCursor ? (
          <button
            type="button"
            className="trade-history-panel__load-more"
            disabled={loadingMore}
            onClick={handleLoadMore}
          >
            <strong>{loadingMore ? "Loading…" : "Load more"}</strong>
          </button>
        ) : null}
      </div>
    </div>
  );
}
