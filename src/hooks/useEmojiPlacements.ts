"use client";
import { useState, useCallback, useEffect } from "react";

export type PlacementMode = "float" | "hang" | "bg";

export interface EmojiPlacement {
  id: string;
  emoji: string;
  mode: PlacementMode;
  x: number; // 0–1 normalized within chart shell
  y: number;
}

const MODE_CYCLE: Record<PlacementMode, PlacementMode> = {
  float: "hang",
  hang: "bg",
  bg: "float",
};

export { MODE_CYCLE };

function storageKey(accountId: string, date: string) {
  return `emoji-placements:${accountId}:${date}`;
}

function loadFromStorage(accountId: string, date: string): EmojiPlacement[] {
  if (!accountId || !date) return [];
  try {
    const raw = localStorage.getItem(storageKey(accountId, date));
    return raw ? (JSON.parse(raw) as EmojiPlacement[]) : [];
  } catch {
    return [];
  }
}

function saveToStorage(accountId: string, date: string, placements: EmojiPlacement[]) {
  try {
    localStorage.setItem(storageKey(accountId, date), JSON.stringify(placements));
  } catch {
    // storage full or unavailable — silently skip
  }
}

export function useEmojiPlacements(accountId: string, date: string) {
  const [placements, setPlacements] = useState<EmojiPlacement[]>(() =>
    loadFromStorage(accountId, date)
  );

  // Reload when account/date changes (list scrolling reuses component)
  useEffect(() => {
    setPlacements(loadFromStorage(accountId, date));
  }, [accountId, date]);

  const addPlacement = useCallback(
    (emoji: string, x: number, y: number) => {
      const p: EmojiPlacement = {
        id: crypto.randomUUID(),
        emoji,
        mode: "float",
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
      };
      // Only one placement at a time — replace any existing
      const next = [p];
      saveToStorage(accountId, date, next);
      setPlacements(next);
    },
    [accountId, date]
  );

  const updateMode = useCallback(
    (id: string, mode: PlacementMode) => {
      setPlacements((prev) => {
        const next = prev.map((p) => (p.id === id ? { ...p, mode } : p));
        saveToStorage(accountId, date, next);
        return next;
      });
    },
    [accountId, date]
  );

  const updatePosition = useCallback(
    (id: string, x: number, y: number) => {
      setPlacements((prev) => {
        const next = prev.map((p) =>
          p.id === id ? { ...p, x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) } : p
        );
        saveToStorage(accountId, date, next);
        return next;
      });
    },
    [accountId, date]
  );

  const remove = useCallback(
    (id: string) => {
      setPlacements((prev) => {
        const next = prev.filter((p) => p.id !== id);
        saveToStorage(accountId, date, next);
        return next;
      });
    },
    [accountId, date]
  );

  return { placements, addPlacement, updateMode, updatePosition, remove };
}
