"use client";
import { useState } from "react";
import { useSession } from "next-auth/react";

export function UsernameSetup() {
  const { data: session, update } = useSession();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (!session?.user?.needsUsername) return null;

  async function handleSave() {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/social/username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: value.trim() }),
      });
      if (res.ok) {
        await update();
      } else {
        const body = await res.json();
        setError(body.error ?? "Failed");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000,
      padding: "24px",
    }}>
      <div style={{
        background: "var(--surface-elevated, #1c1c1e)",
        borderRadius: "16px",
        padding: "24px",
        width: "100%",
        maxWidth: "360px",
        display: "flex",
        flexDirection: "column",
        gap: "14px",
      }}>
        <h2 style={{ margin: 0, fontSize: "18px" }}>Choose your username</h2>
        <p style={{ margin: 0, opacity: 0.6, fontSize: "13px" }}>
          3–20 characters, letters/numbers/underscore
        </p>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. forex_king"
          maxLength={20}
          style={{
            padding: "10px 12px", borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(255,255,255,0.06)",
            color: "inherit", fontSize: "16px",
          }}
        />
        {error && <p style={{ margin: 0, color: "var(--tone-negative, #f87171)", fontSize: "13px" }}>{error}</p>}
        <button
          onClick={handleSave}
          disabled={!value.trim() || saving}
          style={{
            padding: "12px", borderRadius: "8px",
            background: "var(--accent-blue, #3b82f6)",
            border: "none", color: "#fff", cursor: "pointer",
            fontWeight: 600, fontSize: "15px",
            opacity: (!value.trim() || saving) ? 0.5 : 1,
          }}
        >
          {saving ? "Saving…" : "Set Username"}
        </button>
      </div>
    </div>
  );
}
