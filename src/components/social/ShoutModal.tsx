"use client";
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { signIn } from "next-auth/react";
import { useSocialSession } from "@/hooks/useSocialSession";
import { EmojiReactionBar } from "@/components/social/EmojiReactionBar";
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

  function renderCompose() {
    if (session.status === "authenticated") {
      return (
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
      );
    }

    if (session.status === "needsUsername") {
      return (
        <div style={{
          padding: "12px", borderRadius: "10px",
          background: "rgba(251,191,36,0.08)",
          border: "1px solid rgba(251,191,36,0.25)",
          fontSize: "13px", textAlign: "center", color: "rgba(251,191,36,0.9)",
        }}>
          ตั้งชื่อผู้ใช้ก่อนถึงจะ shout ได้ — ปิดหน้าต่างนี้แล้วกรอก username
        </div>
      );
    }

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <p style={{ margin: 0, fontSize: "13px", opacity: 0.6, textAlign: "center" }}>
          Sign in to shout
        </p>
        <button
          onClick={() => signIn("google")}
          style={{
            padding: "10px 16px", borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.06)", color: "inherit",
            cursor: "pointer", fontSize: "14px", display: "flex",
            alignItems: "center", justifyContent: "center", gap: "8px",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </button>
        <button
          onClick={() => signIn("apple")}
          style={{
            padding: "10px 16px", borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.06)", color: "inherit",
            cursor: "pointer", fontSize: "14px", display: "flex",
            alignItems: "center", justifyContent: "center", gap: "8px",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 814 1000" fill="currentColor">
            <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 382.3 13.1 228.2 13.1 196.2c0-163.8 100-248.8 196.4-248.8 50.8 0 93.3 35.5 125.3 35.5 30.4 0 77.9-37.5 141.5-37.5 44.3 0 151.3 4.5 219.2 103.4zm-309.5-82.2c-13.7 62.1 48.8 129.5 119.5 129.5 22.5-63.9-21.3-132.1-119.5-129.5z"/>
          </svg>
          Sign in with Apple
        </button>
      </div>
    );
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

            {renderCompose()}

            <div style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
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
                    {(s.author.username?.[0] ?? "?").toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: "6px", alignItems: "baseline" }}>
                      <span style={{ fontWeight: 600, fontSize: "13px" }}>@{s.author.username}</span>
                      <span style={{ fontSize: "11px", opacity: 0.45 }}>{timeAgo(s.createdAt)}</span>
                    </div>
                    <p style={{ margin: "2px 0 6px", fontSize: "14px", lineHeight: 1.4 }}>{s.message}</p>
                    <EmojiReactionBar targetType="SHOUT" targetId={s.id} compact />
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
