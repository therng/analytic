"use client";
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSocialSession } from "@/hooks/useSocialSession";
import type { ShoutItem } from "@/hooks/useShouts";

const MAX_CHARS = 120;

interface ShoutModalProps {
  shouts: ShoutItem[];
  open: boolean;
  onClose: () => void;
  onPosted: (shout: ShoutItem) => void;
}

function timeAgo(isoString: string): string {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function ShoutModal({ shouts, open, onClose, onPosted }: ShoutModalProps) {
  const session = useSocialSession();
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function handlePost() {
    if (!text.trim() || posting) return;
    setPosting(true);
    try {
      const res = await fetch("/api/social/shouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text.trim() }),
      });
      if (res.ok) {
        const shout: ShoutItem = await res.json();
        onPosted(shout);
        setText("");
      }
    } finally {
      setPosting(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: "fixed", inset: 0,
              background: "rgba(0,0,0,0.6)",
              zIndex: 900,
            }}
            onClick={onClose}
          />
          <motion.div
            key="modal"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            style={{
              position: "fixed", bottom: 0, left: 0, right: 0,
              background: "var(--surface-elevated, #1c1c1e)",
              borderRadius: "16px 16px 0 0",
              padding: "20px 16px calc(20px + env(safe-area-inset-bottom))",
              zIndex: 901,
              maxHeight: "75vh",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600, fontSize: "16px" }}>📢 Shouts</span>
              <button
                onClick={onClose}
                style={{ background: "none", border: "none", color: "inherit", fontSize: "20px", cursor: "pointer" }}
              >
                ×
              </button>
            </div>

            {session.status === "authenticated" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <textarea
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
                  placeholder="What's your shout? (12h)"
                  rows={2}
                  style={{
                    resize: "none", borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: "rgba(255,255,255,0.06)",
                    color: "inherit", padding: "8px 10px", fontSize: "14px",
                  }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "11px", opacity: 0.5 }}>{text.length}/{MAX_CHARS}</span>
                  <button
                    onClick={handlePost}
                    disabled={!text.trim() || posting}
                    style={{
                      padding: "6px 16px", borderRadius: "8px",
                      background: "var(--accent-blue, #3b82f6)",
                      border: "none", color: "#fff", cursor: "pointer",
                      opacity: (!text.trim() || posting) ? 0.5 : 1,
                    }}
                  >
                    {posting ? "…" : "Shout"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => session.status === "unauthenticated" && session.signIn()}
                style={{
                  padding: "10px", borderRadius: "8px",
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "transparent", color: "inherit", cursor: "pointer",
                }}
              >
                Sign in to shout
              </button>
            )}

            <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
              {shouts.length === 0 && (
                <p style={{ opacity: 0.5, fontSize: "13px", textAlign: "center" }}>
                  No shouts yet — be the first
                </p>
              )}
              {shouts.map((s) => (
                <div key={s.id} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                  <div style={{
                    width: "32px", height: "32px", borderRadius: "50%",
                    background: "var(--accent-blue, #3b82f6)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontWeight: 700, fontSize: "14px", flexShrink: 0,
                  }}>
                    {s.author.username[0].toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: "6px", alignItems: "baseline" }}>
                      <span style={{ fontWeight: 600, fontSize: "13px" }}>@{s.author.username}</span>
                      <span style={{ fontSize: "11px", opacity: 0.45 }}>{timeAgo(s.createdAt)}</span>
                    </div>
                    <p style={{ margin: "2px 0 0", fontSize: "14px", lineHeight: 1.4 }}>{s.message}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
