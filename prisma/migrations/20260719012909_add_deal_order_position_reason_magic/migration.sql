-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "magic" INTEGER,
ADD COLUMN     "reason" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "magic" INTEGER,
ADD COLUMN     "price_stoplimit" DECIMAL(28,8),
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "time_expiration" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "reason" TEXT;
