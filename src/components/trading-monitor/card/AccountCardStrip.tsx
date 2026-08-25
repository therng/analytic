"use client";

import { memo } from "react";

import type { SerializedAccount } from "@/lib/trading/types";
import {
  displayName,
  formatCurrency,
  formatPercent,
  toneFromNumber,
} from "@/components/trading-monitor/formatters";

// The card's persistent compact header — the collapsed card in full. Carries
// identity, today growth, and equity from the accounts-list payload alone
// (zero per-card requests while collapsed); the expanded DashboardCard
// renders the same component with live-bridge values so the header never
// changes form between states. The expand/collapse chevron trails the name.
export const AccountCardStrip = memo(function AccountCardStrip({
  account,
  active,
  equity,
  equityMetricName = "Equity",
  equityFlashClass,
  expanded,
  onToggleExpanded,
}: {
  account: SerializedAccount;
  active: boolean;
  equity: number;
  /** Switches to "Balance" while the expanded chart scrub highlights a point. */
  equityMetricName?: string;
  equityFlashClass?: string;
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

  return (
    <div className="sp-header">
      <div className="sp-top sp-top--compact">
        <div className="sp-identity sp-identity--header">
          <div className="sp-name-row">
            <div className="sp-name">{accountDisplayName}</div>
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
      </div>
    </div>
  );
});
