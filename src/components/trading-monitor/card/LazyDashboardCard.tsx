"use client";

import { useCallback, useState } from "react";
import { type SerializedAccount } from "@/lib/trading/types";
import { DashboardCard } from "./DashboardCard";
import { DeferredDashboardCard } from "./DeferredDashboardCard";

const EAGER_ACCOUNT_CARD_COUNT = 2;

export function LazyDashboardCard({
  account,
  index,
  refreshKey,
  onRequestStateChange,
}: {
  account: SerializedAccount;
  index: number;
  refreshKey: number;
  onRequestStateChange: (request: { loading: boolean; refreshKey: number }) => void;
}) {
  const [shouldLoad, setShouldLoad] = useState(index < EAGER_ACCOUNT_CARD_COUNT);
  const handleLoad = useCallback(() => {
    setShouldLoad(true);
  }, []);

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
