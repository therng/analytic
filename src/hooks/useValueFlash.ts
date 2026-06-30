"use client";

import { useEffect, useRef, useState } from "react";

const FLASH_DURATION_MS = 700;

export function useValueFlash(value: number): string {
  const prevRef = useRef<number | null>(null);
  const [flashClass, setFlashClass] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (prevRef.current === null) {
      prevRef.current = value;
      return;
    }
    if (value === prevRef.current) return;

    const direction = value > prevRef.current ? "up" : "down";
    prevRef.current = value;

    clearTimeout(timerRef.current);
    // Clear first so re-triggering the same direction re-animates
    setFlashClass("");

    requestAnimationFrame(() => {
      setFlashClass(`value-flash-${direction}`);
      timerRef.current = setTimeout(() => setFlashClass(""), FLASH_DURATION_MS);
    });
  }, [value]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return flashClass;
}
