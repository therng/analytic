-- AlterTable
ALTER TABLE "BridgeHistoryChunk" ADD COLUMN     "reconstruction_algorithm_version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "WorkerMessageFailure" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "stream_id" TEXT,
    "chunk_id" TEXT,
    "error_code" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkerMessageFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkerMessageFailure_account_id_resolved_idx" ON "WorkerMessageFailure"("account_id", "resolved");

-- AddForeignKey
ALTER TABLE "WorkerMessageFailure" ADD CONSTRAINT "WorkerMessageFailure_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "BridgeHistoryChunk_account_completed_idx" RENAME TO "BridgeHistoryChunk_account_id_completed_at_idx";

-- RenameIndex
ALTER INDEX "BridgeHistoryChunk_account_window_idx" RENAME TO "BridgeHistoryChunk_account_id_window_start_server_time_idx";

-- RenameIndex
ALTER INDEX "BridgeHistoryRecord_chunk_stream_event_key_key" RENAME TO "BridgeHistoryRecord_chunk_id_stream_event_key_key";

-- RenameIndex
ALTER INDEX "BridgeHistoryRecord_chunk_stream_idx" RENAME TO "BridgeHistoryRecord_chunk_id_stream_idx";
