-- Drop indexes that duplicate an existing unique/primary-key access path or
-- have no repository query filtering or sorting by the indexed column.
DROP INDEX IF EXISTS "AccountReportResult_computed_at_idx";
DROP INDEX IF EXISTS "BridgeHistoryRecord_chunk_id_stream_idx";
DROP INDEX IF EXISTS "EquitySnapshot_account_id_ts_idx";
DROP INDEX IF EXISTS "PositionExcursion_account_id_position_ticket_ts_idx";
