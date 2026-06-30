"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Mt5LiveData } from "@/lib/redis-mt5";

const POLL_INTERVAL_MS = 2_000;

export function useLiveData(accountId: string): Mt5LiveData | null {
  const [data, setData] = useState<Mt5LiveData | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const poll = useCallback(async () => {
    if (document.hidden) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/accounts/${accountId}/live`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) return;
      const json = (await res.json()) as Mt5LiveData;
      setData(json);
    } catch {
      // abort or network error — ignore silently
    }
  }, [accountId]);

  useEffect(() => {
    poll();
    const interval = window.setInterval(poll, POLL_INTERVAL_MS);

    const onVisibility = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      abortRef.current?.abort();
    };
  }, [poll]);

  return data;
}
