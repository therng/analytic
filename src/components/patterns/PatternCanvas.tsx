import React, { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CandleData, CandlestickPattern } from "@/lib/patterns/types";
import { Candle } from "./Candle";
import { TrendTrace } from "./TrendTrace";
import { usePatternTimeline } from "@/hooks/usePatternTimeline";

interface PatternCanvasProps {
  pattern: CandlestickPattern;
}

function generateBeforeCandles(pattern: CandlestickPattern, n: number): CandleData[] {
  const isDown = pattern.trend === "down";
  const first = pattern.formation[0];
  const startPrice = pattern.outcome.endPrice;
  const endPrice = isDown
    ? Math.min(first.open, first.close)
    : Math.max(first.open, first.close);
  const totalMove = Math.abs(startPrice - endPrice) || 10;
  const step = totalMove / n;
  const wiggle = Math.max(step * 0.12, 0.5);

  return Array.from({ length: n }, (_, i) => {
    if (isDown) {
      const o = Math.round(startPrice - i * step);
      const c = Math.round(o - step * 0.7);
      return { open: o, high: Math.round(o + wiggle), low: Math.round(c - wiggle), close: c };
    } else {
      const o = Math.round(startPrice + i * step);
      const c = Math.round(o + step * 0.7);
      return { open: o, high: Math.round(c + wiggle), low: Math.round(o - wiggle), close: c };
    }
  });
}

function generateAfterCandles(pattern: CandlestickPattern): CandleData[] {
  const isDown = pattern.trend === "down";
  const last = pattern.formation[pattern.formation.length - 1];
  const basePrice = last.close;
  const targetPrice = pattern.outcome.endPrice;
  const totalMove = Math.abs(targetPrice - basePrice) || 10;
  const N = 2;
  const step = totalMove / N;
  const wiggle = Math.max(step * 0.12, 0.5);

  return Array.from({ length: N }, (_, i) => {
    if (isDown) {
      const o = Math.round(basePrice + i * step);
      const c = Math.round(o + step * 0.7);
      return { open: o, high: Math.round(c + wiggle), low: Math.round(o - wiggle), close: c };
    } else {
      const o = Math.round(basePrice - i * step);
      const c = Math.round(o - step * 0.7);
      return { open: o, high: Math.round(o + wiggle), low: Math.round(c - wiggle), close: c };
    }
  });
}

export const PatternCanvas: React.FC<PatternCanvasProps> = ({ pattern }) => {
  const { stage } = usePatternTimeline();

  const candles = pattern.formation;
  const nBefore = Math.max(3, 6 - candles.length);
  const beforeCandles = useMemo(() => generateBeforeCandles(pattern, nBefore), [pattern, nBefore]);
  const afterCandles = useMemo(() => generateAfterCandles(pattern), [pattern]);

  const priceBounds = useMemo(() => {
    const allPrices = [
      ...candles.flatMap(c => [c.open, c.high, c.low, c.close]),
      ...beforeCandles.flatMap(c => [c.open, c.high, c.low, c.close]),
      ...afterCandles.flatMap(c => [c.open, c.high, c.low, c.close]),
      pattern.outcome.startPrice,
      pattern.outcome.endPrice,
    ];
    const min = Math.min(...allPrices);
    const max = Math.max(...allPrices);
    const padding = (max - min) * 0.18;
    return { min: min - padding, max: max + padding };
  }, [candles, beforeCandles, afterCandles, pattern.outcome]);

  const isBullish = pattern.type === "bullish";
  const showCandles = stage === "formation" || stage === "pause" || stage === "outcome" || stage === "fade";
  const showAfter = stage === "outcome" || stage === "fade";

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
      gap: "12px"
    }}>
      <div style={{ height: "16%", width: "100%", position: "relative", zIndex: 1 }}>
        <AnimatePresence>
          {(stage === "trend" || stage === "fade") && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: stage === "fade" ? 0 : 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              style={{ display: "flex", justifyContent: "center", width: "100%", height: "100%" }}
            >
              <TrendTrace direction={pattern.trend} width={120} height={36} />
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
        gap: "4px"
      }}>
        <AnimatePresence>
          {showCandles && beforeCandles.map((candle, i) => (
            <motion.div
              key={`${pattern.id}-before-${i}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: stage === "fade" ? 0 : 0.3 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, delay: i * 0.04 }}
            >
              <Candle
                data={candle}
                width={9}
                containerHeight={110}
                minPrice={priceBounds.min}
                maxPrice={priceBounds.max}
              />
            </motion.div>
          ))}
        </AnimatePresence>

        <AnimatePresence>
          {showCandles && candles.map((candle, i) => (
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
                containerHeight={110}
                minPrice={priceBounds.min}
                maxPrice={priceBounds.max}
              />
            </motion.div>
          ))}
        </AnimatePresence>

        <AnimatePresence>
          {showAfter && afterCandles.map((candle, i) => (
            <motion.div
              key={`${pattern.id}-after-${i}`}
              initial={{ opacity: 0, scaleY: 0 }}
              animate={{ opacity: stage === "fade" ? 0 : 0.36 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, delay: i * 0.1, ease: "easeOut" }}
              style={{ transformOrigin: "bottom" }}
            >
              <Candle
                data={candle}
                width={9}
                containerHeight={110}
                minPrice={priceBounds.min}
                maxPrice={priceBounds.max}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div style={{ height: "20%", width: "100%", position: "relative", zIndex: 1, display: "flex", justifyContent: "center" }}>
        <AnimatePresence>
          {stage === "outcome" && (
            <motion.svg
              aria-hidden="true"
              viewBox="0 0 128 50"
              initial={{ opacity: 0, y: isBullish ? 8 : -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              style={{ width: "70%", height: "100%", overflow: "visible" }}
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
            animate={{ opacity: 0.12 }}
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
