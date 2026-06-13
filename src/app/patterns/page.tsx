"use client";
import React from "react";
import { allPatterns } from "@/lib/patterns";
import { PatternCard } from "@/components/patterns/PatternCard";

export default function PatternsPage() {
  return (
    <main style={{ 
      background: "#000", 
      minHeight: "100vh", 
      padding: "40px 20px",
      color: "#e8ecf2"
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

        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", 
          gap: "24px" 
        }}>
          {allPatterns.map((pattern) => (
            <PatternCard key={pattern.id} pattern={pattern} />
          ))}
        </div>
      </div>

      <style jsx global>{`
        body {
          background-color: #000;
        }
        .pattern-card {
          transition: transform 0.3s ease;
        }
        .pattern-card:hover {
          transform: translateY(-4px);
          border-color: rgba(59, 130, 246, 0.3) !important;
        }
      `}</style>
    </main>
  );
}
