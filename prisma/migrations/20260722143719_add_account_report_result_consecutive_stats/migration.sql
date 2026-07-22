-- AlterTable
ALTER TABLE "AccountReportResult" ADD COLUMN     "average_consecutive_losses" DOUBLE PRECISION,
ADD COLUMN     "average_consecutive_wins" DOUBLE PRECISION,
ADD COLUMN     "max_consecutive_loss_amount" DECIMAL(28,8),
ADD COLUMN     "max_consecutive_profit_amount" DECIMAL(28,8);
