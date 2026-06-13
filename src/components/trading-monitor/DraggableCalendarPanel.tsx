"use client";
import { memo, useCallback, useRef, useState } from "react";
import { EconomicCalendarList } from "@/components/trading-monitor/EconomicCalendarList";

function DraggableCalendarPanelInner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startTop: number } | null>(null);
  const [topOffset, setTopOffset] = useState(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    dragRef.current = { startY: e.clientY, startTop: topOffset };
  }, [topOffset]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const delta = e.clientY - dragRef.current.startY;
    const card = containerRef.current?.closest<HTMLElement>(".account-card");
    const cardH = card?.clientHeight ?? 400;
    setTopOffset(Math.max(0, Math.min(cardH - 72, dragRef.current.startTop + delta)));
  }, []);

  const onPointerUp = useCallback(() => { dragRef.current = null; }, []);

  const panelStyle: React.CSSProperties | undefined = topOffset > 0 ? { top: topOffset } : undefined;

  return (
    <div
      ref={containerRef}
      className="sp-overlay-panel sp-draggable-panel"
      role="region"
      aria-label="Economic Calendar"
      style={panelStyle}
    >
      <div
        className="sp-draggable-panel__handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="separator"
        aria-label="ลากเพื่อปรับขนาด"
      />
      <div className="eco-cal">
        <EconomicCalendarList />
      </div>
    </div>
  );
}

export const DraggableCalendarPanel = memo(DraggableCalendarPanelInner);
