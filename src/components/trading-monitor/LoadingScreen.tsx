"use client";
import React from "react";

export const LOADING_ANIMATION_MS = 1400;

export function LoadingScreen({ onComplete }: { onComplete?: () => void }) {
  React.useEffect(() => {
    const timer = setTimeout(() => {
      onComplete?.();
    }, LOADING_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return <CandleAnimation />;
}

const CANDLES: [number, number, number, number, number, boolean][] = [
  // [x, bodyTop, bodyHeight, wickTop, wickBottom, isGreen]
  [32, 42, 28, 32, 78, true],
  [60, 52, 18, 44, 76, false],
  [88, 34, 32, 24, 72, true],
  [116, 24, 24, 14, 58, true],
  [144, 38, 16, 30, 64, false],
  [172, 48, 22, 40, 82, false],
];

const GREEN = "#3dd68c";
const RED = "#f04d4d";
const BLUE = "#3b82f6";

interface CandleAnimationProps {
  onTouchStart?: React.TouchEventHandler<HTMLDivElement>;
  onTouchMove?: React.TouchEventHandler<HTMLDivElement>;
  onTouchEnd?: React.TouchEventHandler<HTMLDivElement>;
  onTouchCancel?: React.TouchEventHandler<HTMLDivElement>;
}

export function CandleAnimation({
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
}: CandleAnimationProps) {
  return (
    <div
      className="candle-anim-container"
      role="presentation"
      aria-hidden="true"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
    >
      <svg
        className="candle-anim-chart"
        viewBox="0 0 200 90"
        preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id="cag-green" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur
              in="SourceGraphic"
              stdDeviation="2.5"
              result="blur"
            />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="0 0 0 0 0.239  0 0 0 0 0.839  0 0 0 0 0.549  0 0 0 0.85 0"
              result="glow"
            />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="cag-red" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur
              in="SourceGraphic"
              stdDeviation="2.5"
              result="blur"
            />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="0 0 0 0 0.941  0 0 0 0 0.302  0 0 0 0 0.302  0 0 0 0.85 0"
              result="glow"
            />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="cag-blue" x="-200%" y="-50%" width="500%" height="200%">
            <feGaussianBlur
              in="SourceGraphic"
              stdDeviation="1.2"
              result="blur"
            />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="0 0 0 0 0.231  0 0 0 0 0.510  0 0 0 0 0.965  0 0 0 0.6 0"
              result="glow"
            />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Subtle dashed grid lines */}
        {[28, 50, 70].map((y) => (
          <line
            key={y}
            x1="8"
            y1={y}
            x2="192"
            y2={y}
            stroke={`rgba(59,130,246,0.07)`}
            strokeWidth="0.5"
            strokeDasharray="3,5"
          />
        ))}

        {/* Baseline with blue glow */}
        <line
          className="candle-baseline"
          x1="8"
          y1="84"
          x2="192"
          y2="84"
          stroke={BLUE}
          strokeWidth="0.75"
          filter="url(#cag-blue)"
        />

        {CANDLES.map(([x, bodyTop, bodyH, wickTop, wickBottom, isGreen], i) => (
          <g
            key={i}
            className={`candle-group candle-group--${i + 1}`}
            filter={`url(#cag-${isGreen ? "green" : "red"})`}
          >
            <line
              className="candle-wick"
              x1={x}
              y1={wickTop}
              x2={x}
              y2={wickBottom}
              stroke={isGreen ? GREEN : RED}
              strokeWidth={1}
              strokeLinecap="round"
            />
            <rect
              className="candle-body"
              x={x - 3}
              y={bodyTop}
              width={6}
              height={bodyH}
              rx={1}
              fill={isGreen ? GREEN : RED}
            />
          </g>
        ))}
      </svg>
      <p className="candle-anim-footer">
        Analytic
        {process.env.NEXT_PUBLIC_APP_VERSION
          ? ` ${process.env.NEXT_PUBLIC_APP_VERSION}`
          : ""}
      </p>
    </div>
  );
}
