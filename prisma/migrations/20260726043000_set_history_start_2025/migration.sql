ALTER TABLE "BridgeHistoryCheckpoint"
  ALTER COLUMN "coverage_start_server_time" SET DEFAULT 1735689600,
  ALTER COLUMN "completed_through_server_time" SET DEFAULT 1735689600,
  ALTER COLUMN "deals_cursor_time" SET DEFAULT 1735689600,
  ALTER COLUMN "orders_cursor_time" SET DEFAULT 1735689600;

UPDATE "BridgeHistoryCheckpoint"
SET
  "phase" = 'backfill',
  "coverage_start_server_time" = 1735689600,
  "completed_through_server_time" = 1735689600,
  "deals_cursor_time" = 1735689600,
  "deals_cursor_ticket" = 0,
  "orders_cursor_time" = 1735689600,
  "orders_cursor_ticket" = 0,
  "reconstructionState" = NULL,
  "last_completed_chunk_id" = NULL,
  "backfill_completed_at" = NULL
WHERE "completed_through_server_time" < 1735689600;
