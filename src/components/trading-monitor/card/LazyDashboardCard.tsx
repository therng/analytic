"use client";

import { useCallback, useState } from "react";
import { type SerializedAccount } from "@/lib/trading/types";
import { displayName } from "@/components/trading-monitor/formatters";
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
  onExpand,
}: {
  account: SerializedAccount;
  index: number;
  refreshKey: number;
  onRequestStateChange: (request: {
    loading: boolean;
    refreshKey: number;
  }) => void;
  /** Session-only manual expand pin; undefined = follow the activity default. */
  expansionOverride: boolean | undefined;
  onExpand: () => void;
}) {
  const [shouldLoad, setShouldLoad] = useState(
    index < EAGER_EXPANDED_CARD_COUNT,
  );
  const handleLoad = useCallback(() => {
    setShouldLoad(true);
  }, []);

  // Autonomous default: the server marks accounts whose latest position was
  // opened within the last 24h (still open or since closed) — those render
  // as the full card, quiet ones auto-collapse to the compact strip.
  // Expansion is one-way — tapping a collapsed card pins a session-only
  // expand; collapsing is the autonomous rule's job alone.
  const expanded = expansionOverride ?? account.position_opened_recently;

  const handleExpand = useCallback(() => {
    // Expanding a visible card mounts its body immediately — no skeleton
    // flash through the deferred path.
    setShouldLoad(true);
    onExpand();
  }, [onExpand]);

  if (!expanded) {
    const active = account.status === "Active";
    return (
      <article
        className={`card account-card account-card--collapsed ${active ? "account-card--active" : "account-card--inactive"}`}
      >
        <button
          type="button"
          className="strip-tap"
          onClick={handleExpand}
          aria-label={`Expand ${displayName(account)} details`}
        >
          <AccountCardStrip
            account={account}
            active={active}
            equity={account.equity}
          />
        </button>
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
    />
  );
}
