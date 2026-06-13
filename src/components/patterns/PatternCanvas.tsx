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

  return (
    <div style={{ 
      position: "relative", 
      width: "100%", 
      height: "100%", 
      display: "flex", 
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "20px"
    }}>
      {/* Top: Trend Area */}
      <div style={{ height: "20%", width: "100%", position: "relative" }}>
        <AnimatePresence>
          {stage === "trend" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              style={{ width: "100%", height: "100%" }}
            >
              <TrendTrace direction={pattern.trend} width={120} height={40} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Center: Pattern Area */}
      <div style={{ 
        flex: 1, 
        width: "100%", 
        display: "flex", 
        alignItems: "center", 
        justifyContent: "center",
        gap: "6px"
      }}>
        <AnimatePresence>
          {(stage === "formation" || stage === "pause" || stage === "outcome") && (
            <>
              {candles.map((candle, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scaleY: 0 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  transition={{ 
                    delay: i * 0.2, 
                    duration: 0.4,
                    ease: "easeOut"
                  }}
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

      {/* Bottom: Outcome Area */}
      <div style={{ height: "25%", width: "100%", position: "relative", display: "flex", justifyContent: "center" }}>
        <AnimatePresence>
          {stage === "outcome" && (
            <motion.div
              initial={{ opacity: 0, y: isBullish ? 10 : -10 }}
              animate={{ opacity: 1, y: isBullish ? -10 : 10 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              style={{ 
                width: "80%", 
                height: "2px", 
                background: `linear-gradient(to ${isBullish ? 'top' : 'bottom'}, ${isBullish ? '#3dd68c' : '#f04d4d'}, transparent)`,
                boxShadow: `0 0 15px ${isBullish ? '#3dd68c' : '#f04d4d'}`,
                borderRadius: "2px"
              }}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Glow Effect */}
      <AnimatePresence>
        {stage === "outcome" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.15 }}
            exit={{ opacity: 0 }}
            style={{
              position: "absolute",
              inset: 0,
              background: isBullish ? "#3dd68c" : "#f04d4d",
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
