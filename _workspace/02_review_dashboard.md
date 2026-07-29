# Dashboard review — deposit load field rename (test fixture only)

## Change reviewed

`src/components/trading-monitor/formatters.test.ts` (commit `db53d77`).

Only change under the dashboard domain path: three `SerializedAccount` test
fixtures updated to match the renamed API shape
(`deposit_load_source: "xauusd_filled_order_volume"`, `xauusd_filled_lots`
replacing `xauusd_open_lots`/`xauusd_margin_mode`). No component, panel,
chart, or CSS file changed.

## Verification

`grep` across `src/components/` and `src/app/` for `xauusd_filled_lots`,
`xauusd_open_lots`, `deposit_load_*` — no hits outside this test file. No
dashboard component currently reads or renders `deposit_load_pct` /
`xauusd_filled_lots`; the metric is registry-defined
(`metric-registry.ts`, "OPENS detail chip" `displayTarget`) but not yet
wired into a live panel. Nothing to check for portrait/landscape, touch
targets, chart-first composition, or token usage — no visual surface
changed.

**Verdict: pass** (no UI behavior in scope; fixture-only touch).

dashboard review: pass
