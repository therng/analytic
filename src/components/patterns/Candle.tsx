import React from "react";
import { CandleData } from "@/lib/patterns/types";

interface CandleProps {
  data: CandleData;
  width?: number;
  containerHeight: number;
  minPrice: number;
  maxPrice: number;
}

export const Candle: React.FC<CandleProps> = ({
  data,
  width = 12,
  containerHeight,
  minPrice,
  maxPrice,
}) => {
  const isBullish = data.close > data.open;
  const isDoji = data.close === data.open;
  const color = isBullish
    ? "var(--positive)"
    : isDoji
      ? "var(--text-secondary)"
      : "var(--negative)";
  
  const priceToY = (price: number) => {
    const range = maxPrice - minPrice || 1;
    return containerHeight - ((price - minPrice) / range) * containerHeight;
  };

  const yOpen = priceToY(data.open);
  const yClose = priceToY(data.close);
  const yHigh = priceToY(data.high);
  const yLow = priceToY(data.low);

  const bodyTop = Math.min(yOpen, yClose);
  const bodyHeight = Math.max(Math.abs(yOpen - yClose), 1.5); // Minimum height for visibility

  return (
    <div
      style={{
        width,
        height: containerHeight,
        position: "relative",
        display: "flex",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {/* Wick */}
      <div
        style={{
          position: "absolute",
          top: yHigh,
          height: Math.max(yLow - yHigh, 0),
          width: 1,
          background: color,
          opacity: 0.8,
        }}
      />
      {/* Body */}
      <div
        style={{
          position: "absolute",
          top: bodyTop,
          height: bodyHeight,
          width: "100%",
          background: color,
          borderRadius: 1,
          boxShadow: isBullish
            ? "0 0 8px var(--positive-line)"
            : isDoji
              ? "none"
              : "0 0 8px var(--negative-line)",
        }}
      />
    </div>
  );
};
