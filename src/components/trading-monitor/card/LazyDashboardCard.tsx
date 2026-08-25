"use client";

import { useCallback, useState } from "react";
import { type SerializedAccount } from "@/lib/trading/types";
import { DashboardCard } from "./DashboardCard";
import { DeferredDashboardCard } from "./DeferredDashboardCard";
import { AccountCardStrip } from "./AccountCardStrip";

// Cards expanded near the top of the list mount their full body immediately;
// expanded ones further down keep the deferred observer + 4s fallback (its
// placeholder renders the same strip header, so the summary stays correct)
// so a day where every account trades doesn't front-load every fetch at once.
const EAGER_EXPANDED_CARD_COUNT = 2;

export function LazyDashboardCard({
  account,
  index,
  refreshKey,
  onRequestStateChange,
  expansionOverride,
  onSetExpansion,
}: {
  account: SerializedAccount;
  index: number;
  refreshKey: number;
  onRequestStateChange: (request: {
    loading: boolean;
    refreshKey: number;
  }) => void;
  /** Session-only manual pin; undefined = follow the activity default. */
  expansionOverride: boolean | undefined;
  onSetExpansion: (expanded: boolean) => void;
}) {
  const [shouldLoad, setShouldLoad] = useState(
    index < EAGER_EXPANDED_CARD_COUNT,
  );
  const handleLoad = useCallback(() => {
    setShouldLoad(true);
  }, []);

  // Activity-driven default: an account that traded today or holds open
  // positions renders as the full card; quiet accounts auto-collapse to the
  // compact strip. The chevron pins a manual override for this session.
  const isTradingToday =
    account.today_trade_count > 0 || account.open_position_count > 0;
  const expanded = expansionOverride ?? isTradingToday;

  const handleToggleExpanded = useCallback(() => {
    // Expanding a visible card mounts its body immediately — no skeleton
    // flash through the deferred path.
    if (!expanded) {
      setShouldLoad(true);
    }
    onSetExpansion(!expanded);
  }, [expanded, onSetExpansion]);

  if (!expanded) {
    const active = account.status === "Active";
    return (
      <article
        className={`card account-card account-card--collapsed ${active ? "account-card--active" : "account-card--inactive"}`}
      >
        <AccountCardStrip
          account={account}
          active={active}
          equity={account.equity}
          expanded={false}
          onToggleExpanded={handleToggleExpanded}
        />
      </article>
    );
  }

  if (!shouldLoad) {
    return (
      <DeferredDashboardCard
        account={account}
        onLoad={handleLoad}
        onToggleExpanded={handleToggleExpanded}
      />
    );
  }

  return (
    <DashboardCard
      account={account}
      refreshKey={refreshKey}
      onRequestStateChange={onRequestStateChange}
      onToggleExpanded={handleToggleExpanded}
    />
  );
}
