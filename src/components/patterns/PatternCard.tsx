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
        background: "linear-gradient(160deg, #06091a, #0a0d18)",
        border: "0.5px solid rgba(255, 255, 255, 0.07)",
        borderRadius: "16px",
        padding: "16px",
        aspectRatio: "3/4",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        position: "relative",
        overflow: "hidden",
        boxShadow: "0 10px 30px rgba(0, 0, 0, 0.5)",
      }}
    >
      <PatternCanvas pattern={pattern} />
    </div>
  );
};
