"use client";

import { createContext, useContext } from "react";
import type { Timeframe } from "@/lib/trading/types";

/**
 * Shared timeframe across every dashboard card. The provider lives in
 * DashboardClient; cards fall back to their local state when rendered
 * outside a dashboard (tests, storybook-style harnesses).
 */
const DashboardTimeframeContext = createContext<{
  timeframe: Timeframe | null;
  setTimeframe: (value: Timeframe) => void;
}>({ timeframe: null, setTimeframe: () => undefined });

export function DashboardTimeframeProvider({
  value,
  children,
}: {
  value: { timeframe: Timeframe; setTimeframe: (value: Timeframe) => void };
  children: React.ReactNode;
}) {
  return (
    <DashboardTimeframeContext.Provider value={value}>
      {children}
    </DashboardTimeframeContext.Provider>
  );
}

export function useDashboardTimeframe() {
  return useContext(DashboardTimeframeContext);
}
