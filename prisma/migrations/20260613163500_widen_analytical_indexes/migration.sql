-- Widen the primary analytical ORDER BY indexes to cover their tiebreaker
-- columns so Postgres can satisfy the full sort from the index alone:
--   Deal:     WHERE account_id = ? ORDER BY time ASC, deal_no ASC
--   Position: WHERE account_id = ? ORDER BY close_time ASC, position_no ASC
-- The previous two-column indexes are strict prefixes of the new ones and
-- are therefore replaced (not kept alongside) to avoid redundant write cost.

-- DropIndex
DROP INDEX IF EXISTS "Deal_account_id_time_idx";

-- DropIndex
DROP INDEX IF EXISTS "Position_account_id_close_time_idx";

-- CreateIndex
CREATE INDEX "Deal_account_id_time_deal_no_idx" ON "Deal"("account_id", "time", "deal_no");

-- CreateIndex
CREATE INDEX "Position_account_id_close_time_position_no_idx" ON "Position"("account_id", "close_time", "position_no");
