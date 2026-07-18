-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "margin_mode" TEXT,
ADD COLUMN     "trade_mode" TEXT;

-- AlterTable
ALTER TABLE "AccountReportResult" ADD COLUMN     "ahpr" DOUBLE PRECISION,
ADD COLUMN     "avg_holding_seconds" DOUBLE PRECISION,
ADD COLUMN     "correlation_mfe_mae" DOUBLE PRECISION,
ADD COLUMN     "correlation_profit_mae" DOUBLE PRECISION,
ADD COLUMN     "correlation_profit_mfe" DOUBLE PRECISION,
ADD COLUMN     "ghpr" DOUBLE PRECISION,
ADD COLUMN     "lr_correlation" DOUBLE PRECISION,
ADD COLUMN     "lr_standard_error" DOUBLE PRECISION,
ADD COLUMN     "max_holding_seconds" DOUBLE PRECISION,
ADD COLUMN     "min_holding_seconds" DOUBLE PRECISION,
ADD COLUMN     "z_score" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "fill_policy" TEXT,
ADD COLUMN     "order_time_type" TEXT;
