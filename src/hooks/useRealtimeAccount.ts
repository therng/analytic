import { useEffect, useRef } from "react";

const BASE_RETRY_MS = 2_000;
const MAX_RETRY_MS = 30_000;
const MAX_RETRIES = 10;

export function useRealtimeAccount(accountId: string): void {
  const retryCount = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!accountId) return;

    let cancelled = false;

    function connect() {
      if (cancelled) return;

      const wsBase = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000";
      const wsUrl = wsBase.endsWith("/ws")
        ? `${wsBase}/account/${accountId}`
        : `${wsBase}/ws/account/${accountId}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        retryCount.current = 0;
      };

      ws.onclose = () => {
        if (cancelled) return;
        if (retryCount.current >= MAX_RETRIES) return;
        const delay = Math.min(BASE_RETRY_MS * 2 ** retryCount.current, MAX_RETRY_MS);
        retryCount.current += 1;
        timerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [accountId]);
}
