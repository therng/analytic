import React, { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CandlestickPattern } from "@/lib/patterns/types";
import { Candle } from "./Candle";
import { TrendTrace } from "./TrendTrace";
import { usePatternTimeline } from "@/hooks/usePatternTimeline";

interface PatternCanvasProps {
  pattern: CandlestickPattern;
}

export const PatternCanvas: React.FC<PatternCanvasProps> = ({ pattern }) => {
  const { stage } = usePatternTimeline();

  const candles = pattern.formation;
  
  // Calculate price bounds for consistent scaling
  const priceBounds = useMemo(() => {
    const allPrices = candles.flatMap(c => [c.open, c.high, c.low, c.close]);
    allPrices.push(pattern.outcome.startPrice, pattern.outcome.endPrice);
    const min = Math.min(...allPrices);
    const max = Math.max(...allPrices);
    const padding = (max - min) * 0.2;
    return { min: min - padding, max: max + padding };
  }, [candles, pattern.outcome]);

  const isBullish = pattern.type === "bullish";
  const showCandles = stage === "formation" || stage === "pause" || stage === "outcome" || stage === "fade";
  const outcomePoints = isBullish
    ? "0,42 32,35 64,27 96,16 128,8"
    : "0,8 32,15 64,24 96,34 128,42";

  return (
    <div style={{ 
      position: "relative", 
      width: "100%", 
      height: "100%", 
      display: "flex", 
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "18px"
    }}>
      <div style={{ height: "20%", width: "100%", position: "relative", zIndex: 1 }}>
        <AnimatePresence>
          {(stage === "trend" || stage === "fade") && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: stage === "fade" ? 0 : 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              style={{ display: "flex", justifyContent: "center", width: "100%", height: "100%" }}
            >
              <TrendTrace direction={pattern.trend} width={120} height={40} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div style={{ 
        flex: 1, 
        width: "100%", 
        position: "relative",
        zIndex: 1,
        display: "flex", 
        alignItems: "center", 
        justifyContent: "center",
        gap: "6px"
      }}>
        <AnimatePresence>
          {showCandles && (
            <>
              {candles.map((candle, i) => (
                <motion.div
                  key={`${pattern.id}-${i}-${stage === "fade" ? "fade" : "visible"}`}
                  initial={{ opacity: 0, scaleY: 0 }}
                  animate={{ opacity: stage === "fade" ? 0 : 1, scaleY: 1 }}
                  exit={{ opacity: 0, scaleY: 0.96 }}
                  transition={{ 
                    delay: stage === "formation" ? i * 0.22 : 0, 
                    duration: 0.4,
                    ease: "easeOut"
                  }}
                  style={{ transformOrigin: "bottom" }}
                >
                  <Candle 
                    data={candle} 
                    containerHeight={120} 
                    minPrice={priceBounds.min} 
                    maxPrice={priceBounds.max} 
                  />
                </motion.div>
              ))}
            </>
          )}
        </AnimatePresence>
      </div>

      <div style={{ height: "25%", width: "100%", position: "relative", zIndex: 1, display: "flex", justifyContent: "center" }}>
        <AnimatePresence>
          {stage === "outcome" && (
            <motion.svg
              aria-hidden="true"
              viewBox="0 0 128 50"
              initial={{ opacity: 0, y: isBullish ? 8 : -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              style={{ width: "74%", height: "100%", overflow: "visible" }}
            >
              <motion.polyline
                points={outcomePoints}
                fill="none"
                stroke={isBullish ? "var(--positive)" : "var(--negative)"}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.9, ease: "easeOut" }}
                style={{
                  filter: isBullish
                    ? "drop-shadow(0 0 8px var(--positive))"
                    : "drop-shadow(0 0 8px var(--negative))",
                }}
              />
            </motion.svg>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {stage === "outcome" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.14 }}
            exit={{ opacity: 0 }}
            style={{
              position: "absolute",
              inset: 0,
              background: isBullish ? "var(--positive)" : "var(--negative)",
              filter: "blur(40px)",
              pointerEvents: "none",
              zIndex: 0
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};
