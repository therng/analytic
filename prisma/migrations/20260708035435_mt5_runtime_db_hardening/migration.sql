-- DropIndex
DROP INDEX "OpenPosition_account_id_report_date_idx";

-- CreateIndex
CREATE INDEX "Deal_account_id_time_idx" ON "Deal"("account_id", "time");

-- CreateIndex
CREATE INDEX "Deal_account_id_position_id_idx" ON "Deal"("account_id", "position_id");

-- CreateIndex
CREATE INDEX "Deal_account_id_symbol_idx" ON "Deal"("account_id", "symbol");

-- CreateIndex
CREATE INDEX "OpenPosition_account_id_idx" ON "OpenPosition"("account_id");

-- CreateIndex
CREATE INDEX "Order_account_id_time_setup_idx" ON "Order"("account_id", "time_setup");

-- CreateIndex
CREATE INDEX "Order_account_id_symbol_idx" ON "Order"("account_id", "symbol");

-- CreateIndex
CREATE INDEX "Position_account_id_symbol_idx" ON "Position"("account_id", "symbol");
