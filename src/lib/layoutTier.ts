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
  if (width >= 600) return "mobile-landscape";
  return "mobile-portrait";
}
