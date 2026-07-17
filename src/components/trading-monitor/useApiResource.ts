"use client";

import { useEffect, useRef, useState } from "react";

const FETCH_TIMEOUT_MS = 12_000;
const resourceCache = new Map<string, unknown>();
const inFlightRequests = new Map<string, Promise<unknown>>();

interface ResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

interface UseApiResourceOptions {
  refreshKey?: number;
  onRequestStateChange?: (request: {
    loading: boolean;
    refreshKey: number;
  }) => void;
}

async function requestResource<T>(url: string): Promise<T> {
  const existing = inFlightRequests.get(url);
  if (existing) return existing as Promise<T>;

  const request = fetch(url, { cache: "no-store" })
    .then(async (response) => {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) throw new Error(payload?.error || "Request failed");
      resourceCache.set(url, payload);
      return payload as T;
    })
    .finally(() => {
      inFlightRequests.delete(url);
    });

  inFlightRequests.set(url, request);
  return request;
}

/** Warm a card's lightweight timeframe resources before the timeframe is selected. */
export function prefetchApiResource(url: string) {
  if (resourceCache.has(url) || inFlightRequests.has(url)) return;
  void requestResource(url).catch(() => undefined);
}

export function useApiResource<T>(
  url: string | null,
  options: UseApiResourceOptions = {},
) {
  const refreshKey = options.refreshKey ?? 0;
  const onRequestStateChange = options.onRequestStateChange;
  const [state, setState] = useState<ResourceState<T>>({
    data: null,
    error: null,
    loading: Boolean(url),
  });
  const previousUrlRef = useRef<string | null>(null);
  const requestStateChangeRef = useRef(onRequestStateChange);

  useEffect(() => {
    requestStateChangeRef.current = onRequestStateChange;
  }, [onRequestStateChange]);

  useEffect(() => {
    if (!url) {
      previousUrlRef.current = null;
      return;
    }

    const isSameResource = previousUrlRef.current === url;
    previousUrlRef.current = url;
    const controller = new AbortController();
    let active = true;
    let requestSettled = false;
    // Distinguish timeout-abort from cleanup-abort so the catch knows what happened
    let timedOut = false;

    const timeoutId = window.setTimeout(() => {
      if (!requestSettled) {
        timedOut = true;
        controller.abort();
      }
    }, FETCH_TIMEOUT_MS);

    const notifyRequestState = (loading: boolean) => {
      requestStateChangeRef.current?.({ loading, refreshKey });
    };

    const settleRequest = () => {
      if (requestSettled) return;
      requestSettled = true;
      clearTimeout(timeoutId);
      notifyRequestState(false);
    };

    setState((current) => ({
      data: isSameResource ? current.data : null,
      error: null,
      loading: true,
    }));
    notifyRequestState(true);

    const cached = resourceCache.get(url) as T | undefined;
    if (cached !== undefined && refreshKey === 0) {
      setState({ data: cached, error: null, loading: false });
      settleRequest();
      return () => {
        active = false;
        controller.abort();
      };
    }

    requestResource<T>(url)
      .then((data) => {
        if (!active) return;
        setState({ data, error: null, loading: false });
        settleRequest();
      })
      .catch((error: unknown) => {
        // Cleanup-abort (unmount / url change): discard silently
        if (!active && !timedOut) {
          settleRequest();
          return;
        }

        const message = timedOut
          ? "Request timed out — pull to refresh"
          : error instanceof Error
            ? error.message
            : "Request failed";

        setState((current) => ({
          data: current.data,
          error: message,
          loading: false,
        }));
        settleRequest();
      });

    return () => {
      active = false;
      controller.abort();
      settleRequest();
    };
  }, [refreshKey, url]);

  if (!url) {
    return { data: null, error: null, loading: false };
  }

  return state;
}
