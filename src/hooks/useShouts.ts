"use client";
import { useEffect, useRef, useState } from "react";

export interface ShoutItem {
  id: string;
  message: string;
  expiresAt: string;
  createdAt: string;
  author: { username: string; displayName: string };
}

export function useShouts() {
  const [shouts, setShouts] = useState<ShoutItem[]>([]);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    fetch("/api/social/shouts")
      .then((r) => r.json())
      .then(setShouts)
      .catch(() => {});

    const es = new EventSource("/api/social/shouts/stream");
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const shout: ShoutItem = JSON.parse(e.data);
        setShouts((prev) => {
          const filtered = prev.filter(
            (s) => s.author.username !== shout.author.username
          );
          return [shout, ...filtered];
        });
      } catch {
        // ignore malformed
      }
    };

    return () => {
      es.close();
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setShouts((prev) => prev.filter((s) => new Date(s.expiresAt).getTime() > now));
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  return shouts;
}
