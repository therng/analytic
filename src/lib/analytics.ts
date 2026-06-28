"use client";

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

function pushDataLayer(event: Record<string, unknown>) {
  if (typeof window === "undefined" || !window.dataLayer) {
    return;
  }

  window.dataLayer.push(event);
}

/**
 * GA4 / GTM Event helper
 */
export const trackEvent = (eventName: string, eventParams?: Record<string, unknown>) => {
  pushDataLayer({
    event: eventName,
    ...eventParams,
  });
};

function trackDashboardInteraction(action: string, label: string, value?: unknown) {
  trackEvent("dashboard_interaction", {
    interaction_action: action,
    interaction_label: label,
    interaction_value: value,
  });
}

export const trackTimeframeChange = (accountName: string, timeframe: string) => {
  trackDashboardInteraction("change_timeframe", `${accountName}: ${timeframe}`, timeframe);
};

export const trackKpiExpand = (accountName: string, kpi: string) => {
  trackDashboardInteraction("expand_kpi", `${accountName}: ${kpi}`, kpi);
};

export const trackRefresh = (source: "pull" | "manual" | "resume") => {
  trackDashboardInteraction("refresh_data", source);
};
