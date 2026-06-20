"use client";
import React from "react";
import { allPatterns } from "@/lib/patterns";
import { PatternCard } from "@/components/patterns/PatternCard";

export default function PatternsPage() {
  return (
    <main style={{ 
      background: "var(--bg-void)", 
      minHeight: "100dvh", 
      padding: "calc(24px + env(safe-area-inset-top, 0px)) 12px calc(24px + env(safe-area-inset-bottom, 0px))",
      color: "var(--ink-card)"
    }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <h1 style={{ 
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          border: 0
        }}>
          Candlestick Pattern Knowledge Base
        </h1>

        <div className="pattern-grid">
          {allPatterns.map((pattern) => (
            <PatternCard key={pattern.id} pattern={pattern} />
          ))}
        </div>
      </div>

      <style jsx global>{`
        body {
          background-color: #000;
        }
        .pattern-grid {
          display: grid;
          grid-template-columns: repeat(1, minmax(0, 1fr));
          gap: 14px;
        }
        .pattern-card {
          transition: transform var(--t-slow), border-color var(--t-base), box-shadow var(--t-base);
        }
        .pattern-card:hover {
          transform: translateY(-4px);
          border-color: var(--accent-line) !important;
          box-shadow: var(--shadow-card-hover) !important;
        }
        @media (min-width: 720px) {
          .pattern-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 18px;
          }
        }
        @media (min-width: 1120px) {
          .pattern-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 20px;
          }
        }
      `}</style>
    </main>
  );
}
