# Design-Sync Notes — Analytic UI Kit

## Repo quirks

- **Next.js app, not a component library.** No `dist/` or `.d.ts` tree — the converter runs in synth-entry mode via `.design-sync/ds-entry.tsx`. The `--entry` flag must be passed explicitly.
- **`componentSrcMap` is required.** Without it the converter finds 0 exports (no `.d.ts` tree). All 25 components are pinned in `config.json`.
- **ApexCharts components render as floor cards.** `BotPnLPanel`, `DrawdownEquityPanel`, `PiePanel`, `ProfitHeatmapPanel`, `PerformanceRadar`, `SparklineChart` use `next/dynamic` and cannot be bundled with esbuild. They appear as labelled placeholder cards in the design tool — this is expected.
- **Noto Sans Thai is a runtime font.** It's loaded by Next.js at app startup and not available in the bundle. `runtimeFontPrefixes: ["Noto Sans Thai"]` suppresses the `[FONT_MISSING]` warning. Thai text in designs uses Sarabun as the fallback.
- **`--font-manrope` and `--font-prompt` are Next.js CSS vars.** Set at runtime; CSS in `globals.css` has static fallbacks (`font-family: 'Manrope', sans-serif`). Not a bug.
- **`--accent` and `--border-color` are undefined.** Only `--accent-50` through `--accent-600` exist in `globals.css`. This produces a non-blocking `[TOKENS_MISSING]` warning — safe to ignore.

## Re-sync build command

```bash
node .ds-sync/package-build.mjs \
  --config .design-sync/config.json \
  --node-modules ./node_modules \
  --entry .design-sync/ds-entry.tsx \
  --out ./ds-bundle
```

## Validate command

```bash
node .ds-sync/package-validate.mjs ./ds-bundle
```

## Project URL

https://claude.ai/design/p/d970ed77-c05a-4db8-a52a-3085ba27cdef
