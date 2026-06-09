import { useEffect, useState } from "react";

export type LayoutTier =
  | "mobile-portrait"
  | "mobile-landscape"
  | "tablet-portrait"
  | "tablet-landscape"
  | "desktop";

/**
 * Derives the responsive layout tier from a single width + orientation evaluation.
 * Call on every resize/orientationchange to avoid race conditions between
 * independent matchMedia listeners (especially on iOS).
 */
export function deriveLayoutTier(
  width: number,
  isPortrait: boolean
): LayoutTier {
  if (width >= 1024) return "desktop";
  if (width >= 768 && isPortrait) return "tablet-portrait";
  if (width >= 768 && !isPortrait) return "tablet-landscape";
  // 600–767px portrait has no separate tier — collapses to mobile-landscape intentionally
  if (width >= 600) return "mobile-landscape";
  return "mobile-portrait";
}

/**
 * Hook that returns the current layout tier, updated on resize + orientation change.
 * Single-source evaluation — all tiers are mutually exclusive.
 */
export function useLayoutTier(): LayoutTier {
  const [tier, setTier] = useState<LayoutTier>(() => {
    if (typeof window === "undefined") return "mobile-portrait";
    return deriveLayoutTier(
      window.innerWidth,
      window.matchMedia("(orientation: portrait)").matches
    );
  });

  useEffect(() => {
    const update = () => {
      setTier(
        deriveLayoutTier(
          window.innerWidth,
          window.matchMedia("(orientation: portrait)").matches
        )
      );
    };
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return tier;
}
