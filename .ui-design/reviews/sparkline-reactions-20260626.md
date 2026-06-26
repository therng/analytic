# Design Review: Anonymous Sparkline Reactions

**Reviewed:** 2026-06-26
**Target:** `src/components/social/SparklineReactionRow.tsx`, `src/hooks/useSparklineReactions.ts`, `src/app/api/social/sparkline-reactions/route.ts`, `globals.css` (L2724–2775)
**Focus:** Visual, Usability, Code Quality
**Platform:** Mobile-first (iOS Safari) + Desktop

## Summary

The anonymous sparkline reaction row is a clean, well-scoped feature with good fundamentals — glass-morphism buttons, optimistic updates, localStorage persistence, and correct `aria-pressed` semantics. Three issues warrant fixing: a logic bug in the failure revert path that silently loses the count rollback, missing hover state on desktop, and touch targets below iOS HIG minimums.

**Issues Found:** 5

- Critical: 1
- Major: 1
- Minor: 2
- Suggestions: 1

---

## Critical Issues

### Issue 1: Revert logic does not restore original count on POST failure

**Severity:** Critical
**Location:** `src/hooks/useSparklineReactions.ts:82`
**Category:** Code

**Problem:**
The `catch` block inside `toggle` attempts to revert the optimistic count update, but uses `Math.max(0, prev.counts[emoji] ?? 0)` — which reads the *already-modified* count (after optimistic increment/decrement), so it doesn't change anything. The voted set reverts correctly, but the displayed count remains wrong.

**Impact:**
After a network failure, the button un-highlights visually (voted state reverts) but the count number stays at its optimistically-updated value. User sees a mismatched: button shows unvoted but count is +1 or -1 off. Repeated failures compound drift.

**Code Example:**
```ts
// Before (buggy — prev.counts[emoji] is already delta-modified here)
[emoji]: Math.max(0, (prev.counts[emoji] ?? 0)),

// After — apply negative delta to undo the optimistic change
[emoji]: Math.max(0, (prev.counts[emoji] ?? 0) - delta),
```

---

## Major Issues

### Issue 2: No hover state on desktop

**Severity:** Major
**Location:** `src/app/globals.css:2737`
**Category:** Visual / Usability

**Problem:**
`.sparkline-reaction-btn` defines `transition: background 0.15s, border-color 0.15s, transform 0.1s` but has no `:hover` rule. Desktop users see no interactive affordance when mousing over.

**Impact:**
Buttons appear non-interactive on desktop/laptop. The transition fires on `:active` only, so the animation is invisible unless you click fast enough to see it.

**Code Example:**
```css
/* Add after .sparkline-reaction-btn block */
@media (hover: hover) {
  .sparkline-reaction-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.20);
  }
}
```

Use `@media (hover: hover)` to avoid sticky hover on iOS touch.

---

## Minor Issues

### Issue 3: Touch target too small for iOS HIG

**Severity:** Minor
**Location:** `src/app/globals.css:2741`
**Category:** Usability / Accessibility

**Problem:**
`padding: 2px 6px` with `font-size: 11px` produces a tap target of ~16px tall — well below the Apple HIG 44pt minimum and WCAG 2.5.5 (44×44px).

**Recommendation:**
Increase vertical padding. The absolute-positioned overlay can afford more height; the design reads better with slightly taller pills anyway.

```css
/* Before */
padding: 2px 6px;

/* After */
padding: 5px 8px;
```

---

### Issue 4: No `focus-visible` keyboard style

**Severity:** Minor
**Location:** `src/app/globals.css:2737`
**Category:** Accessibility

**Problem:**
Reaction buttons have no `:focus-visible` rule. Keyboard users tabbing through the dashboard get no visual indication of focus on these buttons.

**Code Example:**
```css
.sparkline-reaction-btn:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.5);
  outline-offset: 2px;
}
```

---

## Suggestions

### Suggestion 1: Surface loading state to prevent double-tap

**Location:** `src/hooks/useSparklineReactions.ts`, `src/components/social/SparklineReactionRow.tsx`

The hook tracks `loading` but it's never consumed in the component. On slow connections, a user can tap multiple times before the first POST completes, firing duplicate requests. Consider disabling `onClick` or adding `pointer-events: none` during `loading`, or at minimum during the optimistic POST in-flight.

A lightweight approach: track a per-emoji `pending` set inside the hook instead of the global `loading` boolean, and add `disabled={pending.has(emoji)}` on each button.

---

## Positive Observations

- Optimistic update pattern is correctly implemented — UI responds instantly with state pre-staged before awaiting fetch.
- `aria-pressed` is semantically correct for a toggle button — assistive technology will read the state correctly.
- `localStorage` key is well-scoped: `sr:{accountId}:{date}` prevents cross-account or cross-date bleed.
- API clamps negative counts with `Math.max(0, newVal)` on both client and server — race conditions handled at both layers.
- `ALLOWED_EMOJIS` allowlist on the server is the right pattern; no emoji injection possible.
- 30-day TTL on Redis keys is sensible for ephemeral social data.
- `touch-action: manipulation` and `-webkit-tap-highlight-color: transparent` are correctly applied for iOS.
- Feature gating to 1D timeframe only (today) is a clean UX decision — reactions on historical dates would be confusing.

## Next Steps

1. **Fix revert bug** (Critical): change `(prev.counts[emoji] ?? 0)` → `(prev.counts[emoji] ?? 0) - delta` in the catch block.
2. **Add hover state** (Major): `@media (hover: hover)` block in CSS.
3. **Increase touch target** (Minor): `padding: 5px 8px`.
4. **Add focus-visible** (Minor): outline rule for keyboard nav.

---

_Generated by UI Design Review — `/ui-design:design-review new feature anonymous emotion`_
