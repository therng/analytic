"use client";
import { useEffect, useRef, useState } from "react";
import { useShouts } from "@/hooks/useShouts";
import { ShoutModal } from "@/components/social/ShoutModal";

export function ShoutTicker() {
  const shouts = useShouts();
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [now, setNow] = useState(() => 0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (shouts.length <= 1) return;
    timerRef.current = setInterval(() => {
      setActiveIdx((i) => (i + 1) % shouts.length);
      setNow(Date.now());
    }, 5_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [shouts.length]);

  if (shouts.length === 0) return null;

  const current = shouts[activeIdx % shouts.length];
  const diffH = Math.floor((new Date(current.expiresAt).getTime() - now) / 3_600_000);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Open shout feed"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          width: "100%",
          padding: "6px 12px",
          background: "rgba(255,255,255,0.04)",
          border: "none",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          color: "inherit",
          cursor: "pointer",
          textAlign: "left",
          fontSize: "13px",
          lineHeight: 1.3,
          overflow: "hidden",
        }}
      >
        <span style={{ opacity: 0.55, flexShrink: 0 }}>📢</span>
        <span style={{ fontWeight: 600, opacity: 0.75, flexShrink: 0 }}>
          @{current.author.username}
        </span>
        <span style={{
          flex: 1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>
          {current.message}
        </span>
        <span style={{ opacity: 0.35, flexShrink: 0, fontSize: "11px" }}>
          {diffH > 0 ? `${diffH}h` : "<1h"}
        </span>
      </button>

      <ShoutModal
        shouts={shouts}
        open={open}
        onClose={() => setOpen(false)}
        onPosted={() => setOpen(false)}
      />
    </>
  );
}
