import React from "react";
import { TrendDirection } from "@/lib/patterns/types";

interface TrendTraceProps {
  direction: TrendDirection;
  width: number;
  height: number;
}

export const TrendTrace: React.FC<TrendTraceProps> = ({ direction, width, height }) => {
  const isUp = direction === "up";
  
  const points = isUp 
    ? `0,${height * 0.78} ${width * 0.25},${height * 0.68} ${width * 0.5},${height * 0.52} ${width * 0.74},${height * 0.38} ${width},${height * 0.26}`
    : `0,${height * 0.22} ${width * 0.25},${height * 0.34} ${width * 0.5},${height * 0.48} ${width * 0.74},${height * 0.62} ${width},${height * 0.76}`;

  return (
    <svg 
      width={width} 
      height={height} 
      style={{ 
        display: "block",
        pointerEvents: "none",
        opacity: 0.28,
        overflow: "visible",
      }}
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--text-secondary)"
        strokeWidth="1.2"
        strokeDasharray="4 5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
