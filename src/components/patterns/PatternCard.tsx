import React from "react";
import { CandlestickPattern } from "@/lib/patterns/types";
import { PatternCanvas } from "./PatternCanvas";

interface PatternCardProps {
  pattern: CandlestickPattern;
}

export const PatternCard: React.FC<PatternCardProps> = ({ pattern }) => {
  return (
    <div 
      className="pattern-card"
      style={{
        background: "linear-gradient(160deg, var(--bg-surface), var(--bg-base))",
        border: "0.5px solid var(--border-subtle)",
        borderRadius: "var(--r-lg)",
        padding: "16px",
        aspectRatio: "3/4",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        position: "relative",
        overflow: "hidden",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <PatternCanvas pattern={pattern} />
    </div>
  );
};
