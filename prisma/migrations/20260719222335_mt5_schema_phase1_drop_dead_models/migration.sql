-- DropForeignKey
ALTER TABLE "EquityState" DROP CONSTRAINT "EquityState_account_number_fkey";

-- DropForeignKey
ALTER TABLE "PositionState" DROP CONSTRAINT "PositionState_account_number_position_id_fkey";

-- DropForeignKey
ALTER TABLE "RiskMetricsSnapshot" DROP CONSTRAINT "RiskMetricsSnapshot_account_id_fkey";

-- AlterTable
ALTER TABLE "ClosedPosition" ALTER COLUMN "open_price" SET DATA TYPE DECIMAL(28,8),
ALTER COLUMN "close_price" SET DATA TYPE DECIMAL(28,8),
ALTER COLUMN "sl" SET DATA TYPE DECIMAL(28,8),
ALTER COLUMN "tp" SET DATA TYPE DECIMAL(28,8),
ALTER COLUMN "commission" SET DATA TYPE DECIMAL(28,8),
ALTER COLUMN "swap" SET DATA TYPE DECIMAL(28,8),
ALTER COLUMN "profit" SET DATA TYPE DECIMAL(28,8),
ALTER COLUMN "net_pnl" SET DATA TYPE DECIMAL(28,8),
ALTER COLUMN "mae_money" SET DATA TYPE DECIMAL(28,8),
ALTER COLUMN "mfe_money" SET DATA TYPE DECIMAL(28,8),
ALTER COLUMN "mae_price" SET DATA TYPE DECIMAL(28,8),
ALTER COLUMN "mfe_price" SET DATA TYPE DECIMAL(28,8),
ALTER COLUMN "max_drawdown_from_peak_max" SET DATA TYPE DECIMAL(28,8);

-- DropTable
DROP TABLE "EquityState";

-- DropTable
DROP TABLE "PositionState";

-- DropTable
DROP TABLE "RiskMetricsSnapshot";

-- DropTable
DROP TABLE "Symbol";

-- CreateIndex
CREATE INDEX "Deal_account_id_type_time_idx" ON "Deal"("account_id", "type", "time");

-- CreateIndex
CREATE INDEX "Position_account_id_symbol_close_time_idx" ON "Position"("account_id", "symbol", "close_time");

