CREATE TABLE "BridgeHistoryCheckpoint" (
    "account_id" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'backfill',
    "coverage_start_server_time" BIGINT NOT NULL DEFAULT 946684800,
    "completed_through_server_time" BIGINT NOT NULL DEFAULT 946684800,
    "deals_cursor_time" BIGINT NOT NULL DEFAULT 946684800,
    "deals_cursor_ticket" BIGINT NOT NULL DEFAULT 0,
    "orders_cursor_time" BIGINT NOT NULL DEFAULT 946684800,
    "orders_cursor_ticket" BIGINT NOT NULL DEFAULT 0,
    "reconstructionState" JSONB,
    "last_completed_chunk_id" TEXT,
    "backfill_completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BridgeHistoryCheckpoint_pkey" PRIMARY KEY ("account_id"),
    CONSTRAINT "BridgeHistoryCheckpoint_phase_check" CHECK ("phase" IN ('backfill', 'incremental')),
    CONSTRAINT "BridgeHistoryCheckpoint_coverage_check" CHECK ("completed_through_server_time" >= "coverage_start_server_time"),
    CONSTRAINT "BridgeHistoryCheckpoint_completion_check" CHECK (
      ("phase" = 'backfill' AND "backfill_completed_at" IS NULL)
      OR ("phase" = 'incremental' AND "backfill_completed_at" IS NOT NULL)
    ),
    CONSTRAINT "BridgeHistoryCheckpoint_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "BridgeHistoryCheckpoint_phase_idx" ON "BridgeHistoryCheckpoint"("phase");

CREATE TABLE "BridgeHistoryChunk" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "parent_chunk_id" TEXT,
    "window_start_server_time" BIGINT NOT NULL,
    "window_end_server_time" BIGINT NOT NULL,
    "deals_cursor_time" BIGINT NOT NULL,
    "deals_cursor_ticket" BIGINT NOT NULL,
    "orders_cursor_time" BIGINT NOT NULL,
    "orders_cursor_ticket" BIGINT NOT NULL,
    "reached_present" BOOLEAN NOT NULL DEFAULT false,
    "deals_expected_count" INTEGER NOT NULL DEFAULT 0,
    "deals_applied_count" INTEGER NOT NULL DEFAULT 0,
    "deals_applied_digest" TEXT NOT NULL DEFAULT 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    "orders_expected_count" INTEGER NOT NULL DEFAULT 0,
    "orders_applied_count" INTEGER NOT NULL DEFAULT 0,
    "orders_applied_digest" TEXT NOT NULL DEFAULT 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    "positions_expected_count" INTEGER NOT NULL DEFAULT 0,
    "positions_applied_count" INTEGER NOT NULL DEFAULT 0,
    "positions_applied_digest" TEXT NOT NULL DEFAULT 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    "deals_barrier_at" TIMESTAMPTZ(3),
    "orders_barrier_at" TIMESTAMPTZ(3),
    "positions_barrier_at" TIMESTAMPTZ(3),
    "deals_barrier_redis_id" TEXT,
    "orders_barrier_redis_id" TEXT,
    "positions_barrier_redis_id" TEXT,
    "reconstruction_state" JSONB,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BridgeHistoryChunk_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BridgeHistoryChunk_window_check" CHECK ("window_end_server_time" > "window_start_server_time"),
    CONSTRAINT "BridgeHistoryChunk_deals_count_check" CHECK ("deals_applied_count" BETWEEN 0 AND "deals_expected_count"),
    CONSTRAINT "BridgeHistoryChunk_orders_count_check" CHECK ("orders_applied_count" BETWEEN 0 AND "orders_expected_count"),
    CONSTRAINT "BridgeHistoryChunk_positions_count_check" CHECK ("positions_applied_count" BETWEEN 0 AND "positions_expected_count"),
    CONSTRAINT "BridgeHistoryChunk_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "BridgeHistoryChunk_account_completed_idx" ON "BridgeHistoryChunk"("account_id", "completed_at");
CREATE INDEX "BridgeHistoryChunk_account_window_idx" ON "BridgeHistoryChunk"("account_id", "window_start_server_time");

CREATE TABLE "BridgeHistoryRecord" (
    "chunk_id" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "event_key" TEXT NOT NULL,
    "payload_sha256" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BridgeHistoryRecord_pkey" PRIMARY KEY ("chunk_id", "stream", "ordinal"),
    CONSTRAINT "BridgeHistoryRecord_chunk_id_fkey"
      FOREIGN KEY ("chunk_id") REFERENCES "BridgeHistoryChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BridgeHistoryRecord_chunk_stream_event_key_key"
  ON "BridgeHistoryRecord"("chunk_id", "stream", "event_key");
CREATE INDEX "BridgeHistoryRecord_chunk_stream_idx"
  ON "BridgeHistoryRecord"("chunk_id", "stream");
