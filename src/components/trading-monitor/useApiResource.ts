"use client";

import { useEffect, useRef, useState } from "react";

interface ResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

interface UseApiResourceOptions {
  refreshKey?: number;
  keepPreviousData?: boolean;
  onRequestStateChange?: (request: { loading: boolean; refreshKey: number }) => void;
}

export function useApiResource<T>(url: string | null, options: UseApiResourceOptions = {}) {
  const refreshKey = options.refreshKey ?? 0;
  const keepPreviousData = options.keepPreviousData ?? false;
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

    const notifyRequestState = (loading: boolean) => {
      requestStateChangeRef.current?.({ loading, refreshKey });
    };

    const settleRequest = () => {
      if (requestSettled) {
        return;
      }

      requestSettled = true;
      notifyRequestState(false);
    };

    setState((current) => ({
      data: (isSameResource || keepPreviousData) ? current.data : null,
      error: null,
      loading: true,
    }));
    notifyRequestState(true);

    const requestInit: RequestInit = {
      cache: "no-store",
      signal: controller.signal,
    };

    fetch(url, requestInit)
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) {
          throw new Error(payload?.error || "Request failed");
        }

        return payload as T;
      })
      .then((data) => {
        if (!active) {
          return;
        }

        setState({
          data,
          error: null,
          loading: false,
        });
        settleRequest();
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) {
          settleRequest();
          return;
        }

        setState((current) => ({
          data: isSameResource ? current.data : null,
          error: error instanceof Error ? error.message : "Request failed",
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
