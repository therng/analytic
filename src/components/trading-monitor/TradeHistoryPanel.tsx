import { useCallback, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { expandRow, tapRow } from "@/lib/animations";
import { formatBangkokDateTime } from "@/lib/time";
import type { PositionsResponse } from "@/lib/trading/types";

import {
  formatPlainNumberValue,
  formatPositionSide,
  formatSignedPlainAmountKpiValue,
  formatTradeComment,
  formatTradePrice,
  getPnlToneClass,
  getSideToneClass,
  positionHistoryNetPnl,
} from "@/components/trading-monitor/dashboardFormatters";
import { InlineState } from "@/components/trading-monitor/MonitorShared";

/** Shared with DashboardCard's cached page-1 request URL — keep in sync. */
export const TRADES_HISTORY_PAGE_LIMIT = 150;

const SKELETON_ROW_COUNT = 8;

type HistoryPosition = PositionsResponse["historyPositions"][number];

function historyRowKey(position: HistoryPosition) {
  return (
    position.positionId ||
    `${position.symbol}-${position.closedAt}-${position.volume}`
  );
}

export function TradeHistoryPanel({
  accountId,
  timeframe,
  page,
  pageLoading,
  pageError,
}: {
  accountId: string;
  timeframe: string;
  /** Cached page-1 payload from the card-level useApiResource. */
  page: PositionsResponse | null;
  pageLoading: boolean;
  pageError: string | null;
}) {
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  // Cursor pages beyond page 1, fetched locally on "Load more". Keyed by
  // account+timeframe so extras from a stale scope hide the moment either
  // changes — no request-id bookkeeping needed.
  const [extraPages, setExtraPages] = useState<{
    key: string;
    rows: HistoryPosition[];
    nextCursor: string | null;
  } | null>(null);

  const pageKey = `${accountId}:${timeframe}`;
  const activeExtras = extraPages?.key === pageKey ? extraPages : null;

  const rows = useMemo(() => {
    const pageRows = page?.historyPositions ?? [];
    if (!activeExtras) return pageRows;
    // Page-1 revalidation can shift rows a cursor page already contains —
    // dedupe by row key so overlaps never render twice.
    const seen = new Set<string>();
    const combined: HistoryPosition[] = [];
    for (const position of [...pageRows, ...activeExtras.rows]) {
      const key = historyRowKey(position);
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(position);
    }
    return combined;
  }, [page, activeExtras]);

  const nextCursor = activeExtras
    ? activeExtras.nextCursor
    : (page?.historyPage?.nextCursor ?? null);

  const handleLoadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    const params = new URLSearchParams({
      timeframe,
      limit: String(TRADES_HISTORY_PAGE_LIMIT),
      cursor: nextCursor,
    });

    setLoadingMore(true);
    setLoadMoreError(null);
    fetch(`/api/accounts/${accountId}/positions?${params}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as
          | (PositionsResponse & { error?: string })
          | null;
        if (!response.ok || !payload) {
          throw new Error(payload?.error ?? "Failed to load more trades");
        }
        return payload;
      })
      .then((data: PositionsResponse) => {
        setExtraPages((current) => ({
          key: pageKey,
          rows: [
            ...(current?.key === pageKey ? current.rows : []),
            ...data.historyPositions,
          ],
          nextCursor: data.historyPage?.nextCursor ?? null,
        }));
      })
      .catch((error: unknown) => {
        setLoadMoreError(
          error instanceof Error
            ? error.message
            : "Failed to load more trades",
        );
      })
      .finally(() => setLoadingMore(false));
  }, [accountId, timeframe, nextCursor, loadingMore, pageKey]);

  if (pageError && !rows.length) {
    return (
      <div
        className="trade-history-panel trade-history-panel--list-only"
        aria-label="Trades list"
      >
        <InlineState
          tone="error"
          title="Trades unavailable"
          message={pageError}
        />
      </div>
    );
  }

  if (pageLoading && !rows.length) {
    return (
      <div
        className="trade-history-panel trade-history-panel--list-only"
        aria-label="Trades list"
        aria-busy="true"
      >
        <div className="trade-history-panel__list">
          {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
            <div
              key={index}
              className="trade-history-skeleton-row"
              aria-hidden="true"
            >
              <div className="skeleton-line skeleton-line--small" />
              <div className="skeleton-line skeleton-line--tiny" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!rows.length) {
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
          const rowKey = historyRowKey(position);
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
                    <span>{formatBangkokDateTime(position.closedAt)}</span>
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
                        {formatBangkokDateTime(position.openedAt)}
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
        {loadMoreError ? (
          <div className="trade-history-panel__load-more-error" role="alert">
            {loadMoreError}
          </div>
        ) : null}
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
