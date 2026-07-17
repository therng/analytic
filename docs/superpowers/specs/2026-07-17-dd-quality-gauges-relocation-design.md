# DD Quality Gauges Relocation Design

## Goal

Move the Sharpe, Profit Factor, and Recovery gauges from DD → MAX into
`PerformanceBars.tsx`, show them above the comparison bars in DD → WIN, and
leave DD → MAX visually empty for a future MAE/MFE panel.

## Component Design

- Move the quality-gauge implementation and its metric configuration from
  `PerformanceQualityPanel.tsx` into `PerformanceBars.tsx`.
- Extend `PerformanceBars` with `sharpeRatio`, `profitFactor`, and
  `recoveryFactor` props. The values continue to come from
  `positionsDetail.data.summary`, preserving the Position metric source
  boundary.
- Render a full-width gauge row before the existing comparison-bar grid.
- Delete `PerformanceQualityPanel.tsx` and remove its import from
  `DashboardCard.tsx`; there will be one owner for the combined WIN panel.

## Dashboard Behaviour

- DD → WIN keeps its current loading skeleton until position detail data is
  available, then renders the three gauges above all existing performance
  comparison bars.
- DD → MAX remains selectable and retains the surrounding overlay canvas,
  but renders no content and no placeholder message. This is the future mount
  point for aggregated MAE/MFE UI.
- Gauge labels, thresholds, value formatting, colors, tap hints, and accessible
  labels remain unchanged.
- Existing comparison bars and their ordering remain unchanged.

## Responsive Layout

- The gauge row spans the full panel width and keeps three equal columns.
- Comparison bars retain their two-column layout below the gauges, including
  the full-width trailing item for an odd count.
- The combined panel must fit the existing scroll/overlay behaviour without
  horizontal panning in mobile portrait or landscape.

## Documentation

Update the DD sub-panel mapping in `AGENTS.md`: MAX is reserved for future
MAE/MFE content, while WIN contains the quality gauges followed by performance
bars.

## Verification

- Add source-contract regression tests before implementation to prove that
  `DashboardCard` no longer renders `PerformanceQualityPanel`, MAX is empty,
  and WIN passes all three quality values to `PerformanceBars`.
- Add a `PerformanceBars` source-contract test proving that the three gauges
  are owned and rendered before the comparison bars.
- Run the focused component tests, `npm run lint`, `npm run build`, and
  `git diff --check`.
- Verify the DD → WIN and DD → MAX states in mobile portrait and landscape.

## Out of Scope

- Designing or implementing the MAE/MFE visualization.
- Changing metric formulas, API response shapes, or analytics sources.
- Reordering or redesigning the existing comparison bars.
