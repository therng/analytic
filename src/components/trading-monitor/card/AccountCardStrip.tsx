"use client";

import { memo } from "react";

import type { SerializedAccount } from "@/lib/trading/types";
import {
  displayName,
  formatCompactCount,
  formatCurrency,
  formatPercent,
  formatSignedCurrency,
  toneFromNumber,
} from "@/components/trading-monitor/formatters";

// The card's persistent compact header — a dealing-row that answers
// "which accounts are in the market today" from the accounts-list payload
// alone (zero per-card requests while collapsed). The expanded DashboardCard
// renders the same component with live-bridge values, so the summary never
// scrolls away and collapsed/expanded look identical.
export const AccountCardStrip = memo(function AccountCardStrip({
  account,
  active,
  equity,
  equityMetricName = "Equity",
  equityFlashClass,
  openCount,
  floatingPl,
  live,
  expanded,
  onToggleExpanded,
}: {
  account: SerializedAccount;
  active: boolean;
  equity: number;
  /** Switches to "Balance" while the expanded chart scrub highlights a point. */
  equityMetricName?: string;
  equityFlashClass?: string;
  openCount: number;
  floatingPl: number;
  /** Live bridge connection — pulses the open-positions dot. */
  live: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const accountLabel = account.account_number
    ? `#${account.account_number}`
    : "Unnumbered";
  const accountDisplayName = displayName(account);
  const todayGrowth = formatPercent(account.today_growth_percent, 1);
  const growthTone = toneFromNumber(account.today_growth_percent);
  const equityLabel = formatCurrency(equity, 2);

  const hasTradesToday = account.today_trade_count > 0;
  const hasOpen = openCount > 0;
  const quiet = !hasTradesToday && !hasOpen;

  return (
    <div className="sp-header">
      <div className="sp-top sp-top--compact">
        <div className="sp-identity sp-identity--header">
          <div className="sp-name">{accountDisplayName}</div>
          <div className="sp-account">
            <span>{accountLabel}</span>
            <span
              className={`sp-account-status ${active ? "is-active" : "is-inactive"}`}
              aria-label={`Account status ${active ? "Active" : "Inactive"}`}
            />
          </div>
        </div>

        <div className="sp-side">
          <div
            className={`sp-growth tone-${growthTone}`}
            aria-label={`Today growth ${todayGrowth}`}
          >
            <strong>{todayGrowth}</strong>
          </div>
          <div
            className={
              equityFlashClass
                ? `sp-balance is-current-live ${equityFlashClass}`.trim()
                : "sp-balance"
            }
            aria-label={`${equityMetricName} ${equityLabel}`}
          >
            <strong>{equityLabel}</strong>
          </div>
        </div>

        <button
          type="button"
          className={`strip-expand${expanded ? " is-expanded" : ""}`}
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${accountDisplayName} details`}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M6 9l6 6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      <div className={`today-rail${quiet ? " is-quiet" : ""}`}>
        <span className="today-rail__eyebrow">TODAY</span>
        {hasTradesToday ? (
          <span className="today-rail__seg">
            <strong className="today-rail__count">
              {formatCompactCount(account.today_trade_count)}
            </strong>
            <span className="today-rail__label">
              {account.today_trade_count === 1 ? "trade" : "trades"}
            </span>
            <strong
              className={`today-rail__pl tone-${toneFromNumber(account.today_net_profit)}`}
            >
              {formatSignedCurrency(account.today_net_profit, 2)}
            </strong>
          </span>
        ) : null}
        {hasOpen ? (
          <span className="today-rail__seg">
            <span
              className={`today-rail__live-dot${live ? " is-live" : ""}`}
              aria-hidden="true"
            />
            <strong className="today-rail__count">
              {formatCompactCount(openCount)}
            </strong>
            <span className="today-rail__label">open</span>
            <strong className={`today-rail__pl tone-${toneFromNumber(floatingPl)}`}>
              {formatSignedCurrency(floatingPl, 2)}
            </strong>
          </span>
        ) : null}
        {quiet ? (
          <span className="today-rail__empty">No trades today</span>
        ) : null}
      </div>
    </div>
  );
});
