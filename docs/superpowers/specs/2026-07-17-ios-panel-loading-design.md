# iOS-style data-panel loading states

Date: 2026-07-17
Status: Approved visual direction — Grouped placeholders (option A)

## Goal

Replace the dashboard's inconsistent internal loading treatments with one quiet, iOS-inspired placeholder system. Loading panels must preserve the final content geometry, communicate that work is active without demanding attention, and reveal real data without layout shift.

The existing full-screen `CandleAnimation` remains unchanged. This design applies only inside account-card data panels and their detail regions.

## Design direction

The selected direction uses dark grouped surfaces, rounded content placeholders, restrained system-style activity indicators, and opacity transitions. It adapts Apple's content-first loading principles to the existing Pure Black Terminal design system rather than copying iOS colors or introducing a second token set.

The memorable element is the calm grouped reveal: each content group resolves independently in place, so the panel appears to become useful instead of switching from a generic loader to a finished layout.

## Shared component model

Add a focused loading primitive under `src/components/trading-monitor/` with semantic variants that describe content anatomy:

- `chart`: title/header remains stable; placeholder chart occupies the final plot area.
- `rows`: repeated circular or compact leading marks, primary lines, and trailing value lines aligned to the final list or table columns.
- `metrics`: compact grouped cells matching KPI detail geometry.
- `combined`: chart placeholder followed by metric or row placeholders for panels that contain both.

Consumers select a variant and row or cell count. They do not define one-off placeholder colors, animation timing, or arbitrary widths. Exact shapes may be passed only when a panel's final geometry cannot be represented by the shared defaults.

## Visual system

- Continue using `--bg-surface`, `--bg-panel`, existing border tokens, text-alpha tokens, spacing tokens, and radius tokens from `design-system/trading-monitor/MASTER.md`.
- Placeholder fill uses an existing low-emphasis surface or text-alpha token. No new Apple-specific color variables are added.
- Containers preserve each panel's current radius and dimensions. Loading must not add an extra card around a panel that is normally open content.
- Placeholder lines use rounded ends. Circular marks appear only where the final row has an icon, avatar, or semantic leading marker.
- A loader that owns an entire panel shows one small indeterminate activity indicator at the trailing edge of its stable header. Inline metric placeholders do not add a second indicator. There is no visible `Loading…` label unless context would otherwise be ambiguous.
- No shimmer sweep, gradients, glow, progress percentage, fake stage names, or decorative status copy.

## Motion and reveal

- Add shared loading motion definitions to `src/lib/animations.ts`; consumers spread those definitions into framer-motion props.
- Active placeholders use a slow opacity breathe. The container does not move or scale.
- When one request supplies the whole panel, the complete placeholder region crossfades to content in the same occupied space. Panels backed by independent requests may reveal each independently loaded group in place. Neither path may change panel height during the transition.
- `prefers-reduced-motion` disables the repeating pulse and uses a direct opacity reveal.
- Loading indicators never change between spinner and progress-bar forms during one request.

## Behavior by request state

### First load with no data

Render the anatomy-matched grouped placeholder immediately with `aria-busy="true"`. Placeholder decoration is `aria-hidden="true"`; a visually hidden live-region message identifies the specific region being prepared.

### Refresh with existing data

Keep usable data visible. The selected option does not replace previously rendered data with placeholders. A small header activity indicator may communicate background refresh if the panel currently exposes that state.

### Success

Reveal real groups in place. Remove `aria-busy` only after the panel has usable content.

### Error or empty result

Use the panel's existing inline error or operational empty state. A placeholder must never remain visible after a request has definitively failed or returned an empty result.

## Initial consumer scope

Apply the shared system to existing internal loaders in:

- `TradeHistoryPanel`
- `OpenPositionsPanel`
- `BotPnLPanel`
- `DrawdownEquityPanel`
- `PerformanceRadar`
- `PerformanceBars`
- `ProfitHeatmapPanel`
- `DashboardCard` detail and KPI-detail regions
- deferred account-card chart and KPI placeholders where the same primitive fits without changing card composition

Loading behavior, request sequencing, pagination, caching, analytics formulas, and API contracts remain unchanged.

## Responsive behavior

- Preserve the existing portrait single-column and landscape two-zone compositions.
- Placeholder geometry follows the same CSS grid and container widths as final content.
- No horizontal panning is introduced for primary loading content.
- Table-like secondary content may retain its existing horizontal overflow behavior.
- All loading indicators are noninteractive and do not create new touch targets.

## Accessibility

- The loading region exposes `aria-busy` and a region-specific screen-reader status.
- Decorative placeholder shapes are hidden from assistive technology.
- Repeating motion respects reduced-motion preferences.
- Placeholder and spinner contrast remains visible on OLED surfaces without competing with real content.
- Error and empty states replace loading semantics promptly.

## Verification

- Add focused component tests for variant structure, row or cell counts, `aria-busy`, hidden decoration, and reduced-motion behavior where it can be asserted reliably.
- Update consumer tests that currently assert generic `skeleton-chart` markup.
- Run `npm run lint` and the relevant trading-monitor test files.
- Run `npm run build` after integration.
- Browser-verify first-load, refresh-with-existing-data, success, error, and empty transitions.
- Capture and inspect mobile portrait and landscape screenshots, checking panel height, overflow, chart/KPI placement, and reduced-motion behavior.

## Out of scope

- Redesigning the full-screen `CandleAnimation`.
- Changing fetch timing, cache policy, pagination, or API payloads.
- Adding determinate progress values without a real measurable progress source.
- Restyling success, error, or empty-state content beyond the loading-to-state transition.
- Introducing Liquid Glass into content-layer panels.
