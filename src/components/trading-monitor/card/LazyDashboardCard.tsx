"use client";

import { useCallback, useState } from "react";
import { type SerializedAccount } from "@/lib/trading/types";
import { DashboardCard } from "./DashboardCard";
import { DeferredDashboardCard } from "./DeferredDashboardCard";
import { AccountCardStrip } from "./AccountCardStrip";

// Cards restored as expanded near the top of the list mount their full body
// immediately; below-fold ones keep the deferred observer + 4s fallback so a
// reload with several expanded cards doesn't front-load every fetch.
const EAGER_EXPANDED_CARD_COUNT = 2;

export function LazyDashboardCard({
  account,
  index,
  refreshKey,
  onRequestStateChange,
  expanded,
  onToggleExpanded,
}: {
  account: SerializedAccount;
  index: number;
  refreshKey: number;
  onRequestStateChange: (request: {
    loading: boolean;
    refreshKey: number;
  }) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const [shouldLoad, setShouldLoad] = useState(
    index < EAGER_EXPANDED_CARD_COUNT,
  );
  const handleLoad = useCallback(() => {
    setShouldLoad(true);
  }, []);

  // Collapsed cards render the compact strip from the accounts-list payload
  // alone — no overview/balance/live-bridge requests until the user expands.
  const handleExpand = useCallback(() => {
    setShouldLoad(true);
    onToggleExpanded();
  }, [onToggleExpanded]);

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
          openCount={account.open_position_count}
          floatingPl={account.floating_pl}
          live={false}
          expanded={false}
          onToggleExpanded={handleExpand}
        />
      </article>
    );
  }

  if (!shouldLoad) {
    return <DeferredDashboardCard account={account} onLoad={handleLoad} />;
  }

  return (
    <DashboardCard
      account={account}
      refreshKey={refreshKey}
      onRequestStateChange={onRequestStateChange}
      onToggleExpanded={onToggleExpanded}
    />
  );
}
