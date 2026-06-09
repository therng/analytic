"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { SerializedAccount } from "@/lib/trading/types";
import { AccountOverviewResponse } from "@/lib/trading/types";
import { SparklineChart } from "@/components/trading-monitor/shared";
import { useRealtimeAccount } from "@/hooks/useRealtimeAccount";
import {
  displayName,
  toneFromNumber,
  formatCurrency,
  formatCompactSignedNumber,
  formatCompactCount,
} from "@/components/trading-monitor/formatters";
import { formatCompactPercent } from "@/components/trading-monitor/DashboardFormatters";
import { useApiResource } from "@/components/trading-monitor/useApiResource";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TabletPortraitOverviewProps {
  accounts: SerializedAccount[];
  refreshKey: number;
  onRequestStateChange: (req: { loading: boolean; refreshKey: number }) => void;
  renderCard: (account: SerializedAccount) => ReactNode;
}

interface TabletPortraitGridProps {
  accounts: SerializedAccount[];
  refreshKey: number;
  onRequestStateChange: (req: { loading: boolean; refreshKey: number }) => void;
  onSelect: (id: string) => void;
}

interface TabletOverviewCardProps {
  account: SerializedAccount;
  refreshKey: number;
  onRequestStateChange: (req: { loading: boolean; refreshKey: number }) => void;
  onSelect: (id: string) => void;
}

interface TabletAccountDetailProps {
  accountId: string;
  accounts: SerializedAccount[];
  onBack: () => void;
  renderCard: (account: SerializedAccount) => ReactNode;
}

// ─── Root component ───────────────────────────────────────────────────────────

export function TabletPortraitOverview({
  accounts,
  refreshKey,
  onRequestStateChange,
  renderCard,
}: TabletPortraitOverviewProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="tablet-overview-root">
      <AnimatePresence mode="wait">
        {expandedId ? (
          <motion.div
            key="detail"
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="tablet-detail-wrap"
          >
            <TabletAccountDetail
              accountId={expandedId}
              accounts={accounts}
              onBack={() => setExpandedId(null)}
              renderCard={renderCard}
            />
          </motion.div>
        ) : (
          <motion.div
            key="grid"
            initial={{ x: "-100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "-100%", opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <TabletPortraitGrid
              accounts={accounts}
              refreshKey={refreshKey}
              onRequestStateChange={onRequestStateChange}
              onSelect={setExpandedId}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Grid view ────────────────────────────────────────────────────────────────

function TabletPortraitGrid({
  accounts,
  refreshKey,
  onRequestStateChange,
  onSelect,
}: TabletPortraitGridProps) {
  return (
    <div className="tablet-overview-grid" role="list" aria-label="Trading accounts">
      {accounts.map((account) => (
        <TabletOverviewCard
          key={account.id}
          account={account}
          refreshKey={refreshKey}
          onRequestStateChange={onRequestStateChange}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

// ─── Grid card ────────────────────────────────────────────────────────────────

function TabletOverviewCard({
  account,
  refreshKey,
  onRequestStateChange,
  onSelect,
}: TabletOverviewCardProps) {
  useRealtimeAccount(account.id);

  const overview = useApiResource<AccountOverviewResponse>(
    `/api/accounts/${account.id}?timeframe=1d`,
    { refreshKey, onRequestStateChange }
  );

  const accountSource = overview.data?.account ?? account;
  const active = accountSource.status === "Active";
  const growth = overview.data?.kpis.periodGrowth;
  const rawTone = toneFromNumber(growth);
  const growthTone: "positive" | "negative" | "neutral" | "muted" =
    rawTone === "warning" ? "neutral" : rawTone;
  const pips = overview.data?.kpis.netPips;
  const trades = overview.data?.kpis.trades;
  const sparklinePoints =
    overview.data?.balanceCurve && overview.data.balanceCurve.length > 0
      ? overview.data.balanceCurve
      : [{ x: "0", y: 0 }];

  return (
    <button
      className={`tablet-overview-card tone-${growthTone} ${active ? "is-active" : "is-inactive"}`}
      role="listitem"
      aria-label={`${displayName(accountSource)} — tap to view details`}
      onClick={() => onSelect(account.id)}
    >
      {/* Header */}
      <div className="toc-header">
        <span className="toc-name">{displayName(accountSource)}</span>
        <span
          className={`toc-beacon ${active ? "is-active" : ""}`}
          aria-label={active ? "Active" : "Inactive"}
        />
      </div>

      {/* Sparkline */}
      <div className="toc-chart" aria-hidden="true">
        {overview.loading && !overview.data ? (
          <div className="skeleton-chart" style={{ height: 32 }} />
        ) : (
          <SparklineChart points={sparklinePoints} active={active} tone={growthTone} />
        )}
      </div>

      {/* Balance */}
      <div className="toc-balance">
        {overview.data ? formatCurrency(accountSource.balance ?? 0, 2) : "—"}
      </div>

      {/* KPI chips */}
      <div className="toc-chips">
        <span className={`toc-chip tone-${growthTone}`}>
          {growth != null ? formatCompactPercent(growth) : "—"}
        </span>
        <span className={`toc-chip tone-${toneFromNumber(pips)}`}>
          {pips != null ? `${formatCompactSignedNumber(pips, 0)}p` : "—"}
        </span>
        <span className="toc-chip tone-muted">
          {trades != null ? `${formatCompactCount(trades)}T` : "—"}
        </span>
      </div>
    </button>
  );
}

// ─── Detail view ──────────────────────────────────────────────────────────────

function TabletAccountDetail({
  accountId,
  accounts,
  onBack,
  renderCard,
}: TabletAccountDetailProps) {
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return null;

  return (
    <div className="tablet-detail-view">
      <button
        className="tablet-back-bar"
        onClick={onBack}
        aria-label="Back to account list"
      >
        <span className="tablet-back-arrow">←</span>
        <span className="tablet-back-label">บัญชีทั้งหมด</span>
      </button>
      <div className="tablet-detail-scroll app-scroll">
        {renderCard(account)}
      </div>
    </div>
  );
}
