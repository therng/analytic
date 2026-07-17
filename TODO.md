# TODO

## MT5 historical data rebuild (planned)

Historical Deal/Order/Position/ClosedPosition data predates `brokerUtcOffsetMinutes` and is
incomplete (old missing-cursor fallback only imported the most recent 30 days). Approved
recovery is a clean rebuild from MT5, not an in-place timestamp correction — do not reintroduce
a bulk offset-shift migration or a `TradingAccount` migration-marker column.

- [ ] Configure `brokerUtcOffsetMinutes` for every account (`scripts/set-broker-utc-offset.ts`)
- [ ] Create a database backup
- [ ] Delete existing MT5-derived historical/runtime records
- [ ] Clear history cursors, backfill state, streams, dedupe state, and derived caches
- [ ] Run automatic full backfill from 2000-01-01
- [ ] Verify newly imported timestamps persist as UTC
- [ ] Verify monthly counts, gaps, duplicates, and timezone correctness post-rebuild
