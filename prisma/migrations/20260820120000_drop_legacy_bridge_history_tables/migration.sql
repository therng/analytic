-- Drop legacy BridgeHistory recovery tables: retained only for manual recovery,
-- never read/written by the active pipeline (bridge SQLite journal owns backfill state).
DROP TABLE IF EXISTS "BridgeHistoryRecord";
DROP TABLE IF EXISTS "BridgeHistoryChunk";
DROP TABLE IF EXISTS "BridgeHistoryCheckpoint";
