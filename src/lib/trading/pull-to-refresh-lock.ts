// Shared gesture lock: dragging the Bot history sheet's drag-handle competes
// with the page-level pull-to-refresh gesture for the same vertical touch
// drag. A counter (not a boolean) tolerates overlapping open/close effects
// across concurrent card renders without one clobbering another's unlock.
let activeSheetCount = 0;

export function lockPullToRefresh() {
  activeSheetCount += 1;
}

export function unlockPullToRefresh() {
  activeSheetCount = Math.max(0, activeSheetCount - 1);
}

export function isPullToRefreshLocked() {
  return activeSheetCount > 0;
}
