"use client";
import { useRef } from "react";
import { motion, useMotionValue } from "framer-motion";
import { MODE_CYCLE, type EmojiPlacement, type PlacementMode } from "@/hooks/useEmojiPlacements";

interface Props {
  placements: EmojiPlacement[];
  sparklinePoints: Array<{ x: number; y: number }>;
  onUpdateMode: (id: string, mode: PlacementMode) => void;
  onUpdatePosition: (id: string, x: number, y: number) => void;
  onRemove: (id: string) => void;
}

const SVG_W = 320;
const SVG_H = 112;

export function EmojiPlacementOverlay({
  placements,
  sparklinePoints,
  onUpdateMode,
  onUpdatePosition,
  onRemove,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  if (!placements.length) return null;

  return (
    <div ref={overlayRef} className="emoji-placement-overlay" aria-hidden="true">
      {placements.map((p) => {
        if (p.mode === "bg") {
          return (
            <BgPlacement
              key={p.id}
              placement={p}
              onCycle={() => onUpdateMode(p.id, MODE_CYCLE["bg"])}
              onRemove={() => onRemove(p.id)}
            />
          );
        }
        if (p.mode === "hang") {
          return (
            <HangPlacement
              key={p.id}
              placement={p}
              sparklinePoints={sparklinePoints}
              onCycle={() => onUpdateMode(p.id, MODE_CYCLE["hang"])}
              onRemove={() => onRemove(p.id)}
            />
          );
        }
        return (
          <FloatPlacement
            key={p.id}
            placement={p}
            containerRef={overlayRef}
            onCycle={() => onUpdateMode(p.id, MODE_CYCLE["float"])}
            onRemove={() => onRemove(p.id)}
            onPositionChange={(x, y) => onUpdatePosition(p.id, x, y)}
          />
        );
      })}
    </div>
  );
}

function FloatPlacement({
  placement,
  containerRef,
  onCycle,
  onRemove,
  onPositionChange,
}: {
  placement: EmojiPlacement;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onCycle: () => void;
  onRemove: () => void;
  onPositionChange: (x: number, y: number) => void;
}) {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didDrag = useRef(false);

  return (
    <motion.div
      className="emoji-placement emoji-placement--float"
      style={{ left: `${placement.x * 100}%`, top: `${placement.y * 100}%`, x: mx, y: my }}
      drag
      dragConstraints={containerRef}
      dragElastic={0.12}
      dragTransition={{ bounceStiffness: 300, bounceDamping: 24, power: 0.35, timeConstant: 380 }}
      onDragStart={() => { didDrag.current = false; }}
      onDrag={() => { didDrag.current = true; }}
      onDragEnd={() => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const nx = (placement.x * rect.width + mx.get()) / rect.width;
        const ny = (placement.y * rect.height + my.get()) / rect.height;
        onPositionChange(nx, ny);
        mx.set(0);
        my.set(0);
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        holdTimer.current = setTimeout(onRemove, 600);
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
      }}
      onPointerCancel={(e) => {
        e.stopPropagation();
        if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
      }}
      onClick={(e) => { e.stopPropagation(); if (!didDrag.current) onCycle(); }}
    >
      {placement.emoji}
    </motion.div>
  );
}

function HangPlacement({
  placement,
  sparklinePoints,
  onCycle,
  onRemove,
}: {
  placement: EmojiPlacement;
  sparklinePoints: Array<{ x: number; y: number }>;
  onCycle: () => void;
  onRemove: () => void;
}) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const svgX = placement.x * SVG_W;
  const nearest = sparklinePoints.length > 0
    ? sparklinePoints.reduce((a, b) => Math.abs(b.x - svgX) < Math.abs(a.x - svgX) ? b : a)
    : { x: svgX, y: SVG_H / 2 };
  const yPct = (nearest.y / SVG_H) * 100;

  return (
    <div
      className="emoji-placement emoji-placement--hang"
      style={{ left: `${placement.x * 100}%`, top: `${yPct}%` }}
      onPointerDown={(e) => { e.stopPropagation(); holdTimer.current = setTimeout(onRemove, 600); }}
      onPointerUp={(e) => { e.stopPropagation(); if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; } }}
      onPointerCancel={(e) => { e.stopPropagation(); if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; } }}
      onClick={(e) => { e.stopPropagation(); onCycle(); }}
    >
      <span className="emoji-placement-hang-line" />
      <span className="emoji-placement-hang-emoji">{placement.emoji}</span>
    </div>
  );
}

function BgPlacement({
  placement,
  onCycle,
  onRemove,
}: {
  placement: EmojiPlacement;
  onCycle: () => void;
  onRemove: () => void;
}) {
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <div
      className="emoji-placement emoji-placement--bg"
      onPointerDown={(e) => { e.stopPropagation(); holdTimer.current = setTimeout(onRemove, 600); }}
      onPointerUp={(e) => { e.stopPropagation(); if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; } }}
      onPointerCancel={(e) => { e.stopPropagation(); if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; } }}
      onClick={(e) => { e.stopPropagation(); onCycle(); }}
    >
      {placement.emoji}
    </div>
  );
}
