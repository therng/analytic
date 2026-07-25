---
name: dashboard-responsive-review
description: Review trading dashboard changes for chart-first composition, mobile portrait and landscape behavior, touch accessibility, interaction safety, and metric-to-panel consistency. Use when changes touch trading-monitor components, globals.css, dashboard account APIs, charts, KPI chips, or expandable panels.
---

# Dashboard Responsive Review

## When to Use

- Review changes under `src/components/trading-monitor/`, `src/app/globals.css`, dashboard pages, or account APIs consumed by the dashboard.
- Use for charts, KPI panels, mobile interactions, loading/empty/error states, or orientation-specific layouts.
- Do not use for backend-only changes that preserve the dashboard contract.

## Required Inputs

- Original request and changed diff.
- Relevant component tests and API response types.
- `AGENTS.md` dashboard composition and responsive rules.
- `design-system/trading-monitor/MASTER.md`.

## Workflow

1. Check the requested panel against the KPI-to-panel mapping and metric registry.
2. Inspect portrait and landscape layouts without changing account order.
3. Verify the primary chart and KPI content avoid sideways panning; allow horizontal scroll only for secondary tables or controls.
4. Check 44×44pt touch targets, long-press cancellation, drag gestures, Escape handling, and scroll-container ownership.
5. Confirm charts that access browser globals remain dynamically imported.
6. Check `dvh`, safe-area behavior, loading shape, inline errors, and operational empty states.
7. Verify token usage against the design-system source; reject decorative gradients, Tailwind default colors, and duplicated token literals.
8. Assess rerender and list-size risk, including windowing for lists above roughly 50 rows.

## Outputs

Return `pass`, `fix`, or `blocked`, with viewport, interaction, and file/line evidence. For durable handoff, write `_workspace/02_review_dashboard.md`.

## Validation

- Portrait and landscape are both verified at mobile dimensions.
- Account ordering and chart-first composition are preserved.
- Interactive elements meet touch and keyboard expectations.
- Visual screenshots accompany user-visible layout changes when practical.
- Data labels and panel content match the actual API fields and metric definitions.
