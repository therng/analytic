import React from "react";
import { TrendDirection } from "@/lib/patterns/types";

interface TrendTraceProps {
  direction: TrendDirection;
  width: number;
  height: number;
}

export const TrendTrace: React.FC<TrendTraceProps> = ({ direction, width, height }) => {
  const isUp = direction === "up";
  
  // Create a simple polyline for the trend
  const points = isUp 
    ? `0,${height * 0.8} ${width * 0.3},${height * 0.7} ${width * 0.6},${height * 0.5} ${width},${height * 0.4}`
    : `0,${height * 0.2} ${width * 0.3},${height * 0.3} ${width * 0.6},${height * 0.5} ${width},${height * 0.6}`;

  return (
    <svg 
      width={width} 
      height={height} 
      style={{ 
        position: "absolute", 
        top: 0, 
        left: 0, 
        pointerEvents: "none",
        opacity: 0.25 
      }}
    >
      <polyline
        points={points}
        fill="none"
        stroke="#8899aa"
        strokeWidth="1"
        strokeDasharray="4 4"
      />
    </svg>
  );
};
