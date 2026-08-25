"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { usePathname } from "next/navigation";
import { trackRefresh, trackEvent, trackCardExpand } from "@/lib/analytics";

import type { SerializedAccount } from "@/lib/trading/types";
import { isPullToRefreshLocked } from "@/lib/trading/pull-to-refresh-lock";

import {
  InlineState,
  TradingMonitorSharedStyles,
} from "@/components/trading-monitor/MonitorShared";
import { useApiResource } from "@/components/trading-monitor/useApiResource";
import { CandleAnimation } from "@/components/trading-monitor/LoadingScreen";
import { DashboardTimeframeProvider } from "./DashboardTimeframeContext";
import { LazyDashboardCard } from "./card/LazyDashboardCard";

const PULL_THRESHOLD = 72;
const REFRESH_HOLD_DISTANCE = 52;
const MIN_REFRESH_VISIBLE_MS = 520;
const SPINNER_CIRCUMFERENCE = 62.83;

// Which cards the operator left expanded — restored after reload so drill-in
// context survives ("drill next, no lost context"). Cards always start
// collapsed in the first paint; persistence is applied post-mount so server
// and client HTML match.
const EXPANDED_CARDS_STORAGE_KEY = "analytic:expanded-cards";

function readExpandedAccountIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(EXPANDED_CARDS_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function writeExpandedAccountIds(ids: Set<string>) {
  try {
    window.localStorage.setItem(EXPANDED_CARDS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage unavailable (private mode) — expansion just won't persist.
  }
}

function applyPullResistance(delta: number) {
  if (delta <= 0) return 0;
  // Dynamic resistance: harder to pull as you go further
  return Math.pow(delta, 0.82) * 2.2;
}

export default function DashboardClient() {
  const pathname = usePathname();
  const [refreshKey, setRefreshKey] = useState(0);
  const [sharedTimeframe, setSharedTimeframe] =
    useState<import("@/lib/trading/types").Timeframe>("1d");
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pendingRefreshRequests, setPendingRefreshRequests] = useState(0);
  const [hasSeenRefreshRequest, setHasSeenRefreshRequest] = useState(false);
  const [expandedAccountIds, setExpandedAccountIds] = useState<Set<string>>(
    () => new Set(),
  );
  const expandedAccountIdsRef = useRef(expandedAccountIds);

  useEffect(() => {
    const persisted = readExpandedAccountIds();
    expandedAccountIdsRef.current = persisted;
    setExpandedAccountIds(persisted);
  }, []);

  const handleToggleCardExpanded = useCallback((accountId: string) => {
    const current = expandedAccountIdsRef.current;
    const next = new Set(current);
    const expanding = !next.has(accountId);
    if (expanding) {
      next.add(accountId);
    } else {
      next.delete(accountId);
    }
    expandedAccountIdsRef.current = next;
    writeExpandedAccountIds(next);
    trackCardExpand(accountId, expanding);
    setExpandedAccountIds(next);
  }, []);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pullStartYRef = useRef<number | null>(null);
  const pullStartXRef = useRef<number | null>(null);
  const pullActiveRef = useRef(false);
  const activeRefreshKeyRef = useRef<number | null>(null);
  const refreshStartedAtRef = useRef(0);
  const refreshingRef = useRef(false);
  const resumeRefreshArmedRef = useRef(false);

  useEffect(() => {
    trackEvent("page_view", {
      page_path: pathname,
      page_title: document.title,
    });
  }, [pathname]);

  const handleRequestStateChange = useCallback(
    ({
      loading,
      refreshKey: requestRefreshKey,
    }: {
      loading: boolean;
      refreshKey: number;
    }) => {
      if (
        !refreshingRef.current ||
        requestRefreshKey !== activeRefreshKeyRef.current
      ) {
        return;
      }

      if (loading) {
        setHasSeenRefreshRequest(true);
      }

      setPendingRefreshRequests((current) =>
        loading ? current + 1 : Math.max(0, current - 1),
      );
    },
    [],
  );

  const accounts = useApiResource<SerializedAccount[]>("/api/accounts", {
    refreshKey,
    onRequestStateChange: handleRequestStateChange,
  });

  const finishPull = useCallback(() => {
    pullStartYRef.current = null;
    pullStartXRef.current = null;
    pullActiveRef.current = false;
    setIsPulling(false);
  }, []);

  const getScrollTop = useCallback(() => {
    const scrollNode = scrollRef.current;
    if (scrollNode && scrollNode.scrollHeight > scrollNode.clientHeight) {
      return scrollNode.scrollTop;
    }

    return typeof window !== "undefined" ? window.scrollY : 0;
  }, []);

  const triggerRefresh = useCallback(() => {
    if (refreshingRef.current) {
      return;
    }

    const startedAt = performance.now();
    refreshingRef.current = true;
    refreshStartedAtRef.current = startedAt;
    setHasSeenRefreshRequest(false);
    setPendingRefreshRequests(0);
    setIsRefreshing(true);
    setPullDistance(REFRESH_HOLD_DISTANCE);
    setRefreshKey((current) => {
      const next = current + 1;
      activeRefreshKeyRef.current = next;
      return next;
    });
  }, []);

  const triggerResumeRefresh = useCallback(() => {
    if (refreshingRef.current) {
      return;
    }

    setRefreshKey((current) => current + 1);
  }, []);

  useEffect(() => {
    const refreshOnResume = () => {
      if (
        !resumeRefreshArmedRef.current ||
        document.visibilityState === "hidden"
      ) {
        return;
      }

      resumeRefreshArmedRef.current = false;
      trackRefresh("resume");
      triggerResumeRefresh();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        resumeRefreshArmedRef.current = true;
        return;
      }

      refreshOnResume();
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        return;
      }

      resumeRefreshArmedRef.current = true;
      refreshOnResume();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("focus", refreshOnResume);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("focus", refreshOnResume);
    };
  }, [triggerResumeRefresh]);

  useEffect(() => {
    if (!isRefreshing || !hasSeenRefreshRequest || pendingRefreshRequests > 0) {
      return;
    }

    const elapsed = performance.now() - refreshStartedAtRef.current;
    const timer = window.setTimeout(
      () => {
        refreshingRef.current = false;
        setIsRefreshing(false);
        setPullDistance(0);
      },
      Math.max(0, MIN_REFRESH_VISIBLE_MS - elapsed),
    );

    return () => window.clearTimeout(timer);
  }, [hasSeenRefreshRequest, isRefreshing, pendingRefreshRequests]);

  const handleTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      const scrollTop = getScrollTop();

      if (
        refreshingRef.current ||
        scrollTop > 0 ||
        isPullToRefreshLocked()
      ) {
        pullStartYRef.current = null;
        pullStartXRef.current = null;
        pullActiveRef.current = false;
        return;
      }

      pullStartYRef.current = event.touches[0]?.clientY ?? null;
      pullStartXRef.current = event.touches[0]?.clientX ?? null;
      pullActiveRef.current = false;
    },
    [getScrollTop],
  );

  const handleTouchMove = useCallback(
    (event: ReactTouchEvent<HTMLDivElement>) => {
      if (refreshingRef.current || isPullToRefreshLocked()) {
        if (pullActiveRef.current) {
          finishPull();
          setPullDistance(0);
        }
        return;
      }

      const startY = pullStartYRef.current;
      const startX = pullStartXRef.current;
      const currentY = event.touches[0]?.clientY;
      const currentX = event.touches[0]?.clientX;
      const scrollTop = getScrollTop();

      if (
        startY == null ||
        startX == null ||
        currentY == null ||
        currentX == null
      ) {
        return;
      }

      const delta = currentY - startY;
      const deltaX = currentX - startX;
      if (Math.abs(deltaX) > 12 && Math.abs(deltaX) > Math.abs(delta)) {
        finishPull();
        if (!refreshingRef.current) {
          setPullDistance(0);
        }
        return;
      }

      if (delta <= 0 || scrollTop > 0) {
        if (!pullActiveRef.current) {
          return;
        }

        finishPull();
        setPullDistance(0);
        return;
      }

      pullActiveRef.current = true;
      setIsPulling(true);
      if (event.cancelable) {
        event.preventDefault();
      }
      setPullDistance(applyPullResistance(delta));
    },
    [finishPull, getScrollTop],
  );

  const handleTouchEnd = useCallback(() => {
    const shouldRefresh =
      pullActiveRef.current && pullDistance >= PULL_THRESHOLD;
    finishPull();

    if (shouldRefresh) {
      trackRefresh("pull");
      triggerRefresh();
      return;
    }

    if (!refreshingRef.current) {
      setPullDistance(0);
    }
  }, [finishPull, pullDistance, triggerRefresh]);

  const pullProgress = Math.min(pullDistance / PULL_THRESHOLD, 1);
  const spinnerDashOffset = isRefreshing
    ? SPINNER_CIRCUMFERENCE * 0.28
    : SPINNER_CIRCUMFERENCE * (1 - pullProgress * 0.72);
  const scrollStyle: CSSProperties = {
    transform: `translate3d(0, ${pullDistance}px, 0)`,
    transition: isPulling
      ? "none"
      : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
  };

  return (
    <main className="monitor-page">
      <TradingMonitorSharedStyles />
      <div
        className={
          isRefreshing || pullDistance > 0
            ? "pull-refresh is-visible"
            : "pull-refresh"
        }
        aria-hidden="true"
      >
        <div
          className={
            isRefreshing
              ? "pull-refresh__badge is-refreshing"
              : pullDistance > 0
                ? "pull-refresh__badge is-pulling"
                : "pull-refresh__badge"
          }
        >
          <svg
            className="pull-refresh__spinner"
            viewBox="0 0 24 24"
            focusable="false"
          >
            <circle className="pull-refresh__track" cx="12" cy="12" r="10" />
            <circle
              className="pull-refresh__ring"
              cx="12"
              cy="12"
              r="10"
              style={{
                strokeDasharray: SPINNER_CIRCUMFERENCE,
                strokeDashoffset: spinnerDashOffset,
              }}
            />
          </svg>
        </div>
      </div>
      <div
        ref={scrollRef}
        className={
          isRefreshing
            ? "app-scroll dashboard-scroll is-refreshing"
            : "app-scroll dashboard-scroll"
        }
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        style={scrollStyle}
      >
        <DashboardTimeframeProvider
          value={{ timeframe: sharedTimeframe, setTimeframe: setSharedTimeframe }}
        >
          <section
            className={`dashboard-section${accounts.data?.length ? " dashboard-content-enter" : ""}`}
            aria-label="Trading accounts"
          >
            {accounts.data?.length
              ? accounts.data.map((account, index) => (
                  <LazyDashboardCard
                    key={account.id}
                    account={account}
                    index={index}
                    refreshKey={refreshKey}
                    onRequestStateChange={handleRequestStateChange}
                    expanded={expandedAccountIds.has(account.id)}
                    onToggleExpanded={() =>
                      handleToggleCardExpanded(account.id)
                    }
                  />
                ))
              : null}
          </section>
        </DashboardTimeframeProvider>
      </div>
      {accounts.loading && !accounts.data ? (
        <CandleAnimation />
      ) : !accounts.loading && accounts.error ? (
        <div className="candle-anim-container" role="alert">
          <InlineState
            tone="error"
            title="Accounts unavailable"
            message={accounts.error ?? "Failed to load accounts."}
          />
        </div>
      ) : !accounts.loading && !accounts.data?.length ? (
        <CandleAnimation />
      ) : null}
    </main>
  );
}
