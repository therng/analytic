-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "order_id" TEXT,
ADD COLUMN     "position_id" TEXT;

-- AlterTable
ALTER TABLE "EquitySnapshot" ADD COLUMN     "drawdown" DECIMAL(28,8),
ADD COLUMN     "floating_pl" DECIMAL(28,8),
ADD COLUMN     "peak_equity" DECIMAL(28,8);

-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "mae" DECIMAL(28,8),
ADD COLUMN     "mfe" DECIMAL(28,8);

-- AlterTable
ALTER TABLE "PositionExcursion" ADD COLUMN     "running_mae" DECIMAL(28,8),
ADD COLUMN     "running_mfe" DECIMAL(28,8);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "order_ticket" TEXT NOT NULL,
    "position_id" TEXT,
    "deal_id" TEXT,
    "symbol" TEXT,
    "type" TEXT,
    "state" TEXT,
    "volume" DOUBLE PRECISION,
    "price_open" DECIMAL(28,8),
    "price_current" DECIMAL(28,8),
    "sl" DECIMAL(28,8),
    "tp" DECIMAL(28,8),
    "time_setup" TIMESTAMP(3),
    "time_done" TIMESTAMP(3),
    "comment" TEXT,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BridgePosition" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "position_no" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,
    "open_time" TIMESTAMP(3),
    "open_price" DECIMAL(28,8),
    "close_time" TIMESTAMP(3),
    "close_price" DECIMAL(28,8),
    "commission" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "swap" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "profit" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "comment" TEXT,
    "mae" DECIMAL(28,8),
    "mfe" DECIMAL(28,8),
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BridgePosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BridgeDeal" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "deal_no" TEXT NOT NULL,
    "position_id" TEXT,
    "order_id" TEXT,
    "time" TIMESTAMP(3) NOT NULL,
    "symbol" TEXT,
    "type" TEXT NOT NULL,
    "volume" DOUBLE PRECISION,
    "price" DECIMAL(28,8),
    "commission" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "fee" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "swap" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "profit" DECIMAL(28,8) NOT NULL DEFAULT 0,
    "comment" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BridgeDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BridgeOrder" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "order_ticket" TEXT NOT NULL,
    "position_id" TEXT,
    "deal_id" TEXT,
    "symbol" TEXT,
    "type" TEXT,
    "state" TEXT,
    "volume" DOUBLE PRECISION,
    "price_open" DECIMAL(28,8),
    "sl" DECIMAL(28,8),
    "tp" DECIMAL(28,8),
    "time_setup" TIMESTAMP(3),
    "time_done" TIMESTAMP(3),
    "comment" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BridgeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Order_account_id_position_id_idx" ON "Order"("account_id", "position_id");

-- CreateIndex
CREATE UNIQUE INDEX "Order_account_id_order_ticket_key" ON "Order"("account_id", "order_ticket");

-- CreateIndex
CREATE UNIQUE INDEX "BridgePosition_account_id_position_no_key" ON "BridgePosition"("account_id", "position_no");

-- CreateIndex
CREATE UNIQUE INDEX "BridgeDeal_account_id_deal_no_key" ON "BridgeDeal"("account_id", "deal_no");

-- CreateIndex
CREATE UNIQUE INDEX "BridgeOrder_account_id_order_ticket_key" ON "BridgeOrder"("account_id", "order_ticket");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgePosition" ADD CONSTRAINT "BridgePosition_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgeDeal" ADD CONSTRAINT "BridgeDeal_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgeOrder" ADD CONSTRAINT "BridgeOrder_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
