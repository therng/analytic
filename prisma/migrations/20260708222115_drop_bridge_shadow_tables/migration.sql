/*
  Warnings:

  - You are about to drop the `BridgeDeal` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `BridgeOrder` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `BridgePosition` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `social_reactions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "BridgeDeal" DROP CONSTRAINT "BridgeDeal_account_id_fkey";

-- DropForeignKey
ALTER TABLE "BridgeOrder" DROP CONSTRAINT "BridgeOrder_account_id_fkey";

-- DropForeignKey
ALTER TABLE "BridgePosition" DROP CONSTRAINT "BridgePosition_account_id_fkey";

-- DropForeignKey
ALTER TABLE "social_reactions" DROP CONSTRAINT "social_reactions_author_id_fkey";

-- DropTable
DROP TABLE "BridgeDeal";

-- DropTable
DROP TABLE "BridgeOrder";

-- DropTable
DROP TABLE "BridgePosition";

-- DropTable
DROP TABLE "social_reactions";

-- CreateTable
CREATE TABLE "Symbol" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "description" TEXT,
    "digits" INTEGER NOT NULL,
    "tradeMode" INTEGER NOT NULL,
    "spread" INTEGER NOT NULL,
    "minLot" DECIMAL(28,8) NOT NULL,
    "maxLot" DECIMAL(28,8) NOT NULL,
    "lotStep" DECIMAL(28,8) NOT NULL,
    "tickSize" DECIMAL(28,8) NOT NULL,
    "tickValue" DECIMAL(28,8) NOT NULL,
    "contractSize" DECIMAL(28,8) NOT NULL,
    "currencyBase" TEXT NOT NULL,
    "currencyProfit" TEXT NOT NULL,
    "currencyMargin" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Symbol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquityState" (
    "account_number" TEXT NOT NULL,
    "balance" DECIMAL(65,30) NOT NULL,
    "equity" DECIMAL(65,30) NOT NULL,
    "margin" DECIMAL(65,30) NOT NULL,
    "free_margin" DECIMAL(65,30) NOT NULL,
    "margin_level" DOUBLE PRECISION,
    "credit" DECIMAL(65,30) NOT NULL,
    "floating_profit" DECIMAL(65,30) NOT NULL,
    "peak_equity" DECIMAL(65,30) NOT NULL,
    "peak_equity_at" TIMESTAMP(3) NOT NULL,
    "drawdown_money" DECIMAL(65,30) NOT NULL,
    "drawdown_percent" DOUBLE PRECISION NOT NULL,
    "max_drawdown_money" DECIMAL(65,30) NOT NULL,
    "max_drawdown_percent" DOUBLE PRECISION NOT NULL,
    "max_drawdown_at" TIMESTAMP(3),
    "last_ping" INTEGER,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EquityState_pkey" PRIMARY KEY ("account_number")
);

-- CreateTable
CREATE TABLE "PositionState" (
    "account_number" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "open_time" TIMESTAMP(3) NOT NULL,
    "open_price" DECIMAL(65,30) NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,
    "current_price" DECIMAL(65,30) NOT NULL,
    "floating_profit" DECIMAL(65,30) NOT NULL,
    "swap" DECIMAL(65,30) NOT NULL,
    "floating_pnl_net" DECIMAL(65,30) NOT NULL,
    "mae_money" DECIMAL(65,30) NOT NULL,
    "mfe_money" DECIMAL(65,30) NOT NULL,
    "mae_price" DECIMAL(65,30),
    "mfe_price" DECIMAL(65,30),
    "peak_profit" DECIMAL(65,30) NOT NULL,
    "max_drawdown_from_peak" DECIMAL(65,30) NOT NULL,
    "max_drawdown_from_peak_max" DECIMAL(65,30) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PositionState_pkey" PRIMARY KEY ("account_number","position_id")
);

-- CreateTable
CREATE TABLE "ClosedPosition" (
    "account_number" TEXT NOT NULL,
    "position_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,
    "open_time" TIMESTAMP(3) NOT NULL,
    "open_price" DECIMAL(65,30) NOT NULL,
    "close_time" TIMESTAMP(3) NOT NULL,
    "close_price" DECIMAL(65,30) NOT NULL,
    "sl" DECIMAL(65,30),
    "tp" DECIMAL(65,30),
    "commission" DECIMAL(65,30) NOT NULL,
    "swap" DECIMAL(65,30) NOT NULL,
    "profit" DECIMAL(65,30) NOT NULL,
    "net_pnl" DECIMAL(65,30) NOT NULL,
    "mae_money" DECIMAL(65,30),
    "mfe_money" DECIMAL(65,30),
    "mae_price" DECIMAL(65,30),
    "mfe_price" DECIMAL(65,30),
    "max_drawdown_from_peak_max" DECIMAL(65,30),
    "comment" TEXT,
    "magic" INTEGER,
    "reason" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClosedPosition_pkey" PRIMARY KEY ("account_number","position_id")
);

-- CreateTable
CREATE TABLE "WorkingOrder" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "order_no" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,
    "price_open" DECIMAL(28,8) NOT NULL,
    "price_current" DECIMAL(28,8) NOT NULL,
    "sl" DECIMAL(28,8),
    "tp" DECIMAL(28,8),
    "time_setup" TIMESTAMP(3) NOT NULL,
    "time_expiration" TIMESTAMP(3),
    "comment" TEXT,
    "magic" INTEGER,
    "report_date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkingOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskMetricsSnapshot" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "sharpe" DOUBLE PRECISION,
    "sortino" DOUBLE PRECISION,
    "var_95" DOUBLE PRECISION,
    "profit_factor" DOUBLE PRECISION,
    "win_rate" DOUBLE PRECISION,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskMetricsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL,
    "magic" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Symbol_symbol_key" ON "Symbol"("symbol");

-- CreateIndex
CREATE INDEX "Symbol_symbol_idx" ON "Symbol"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "EquityState_account_number_key" ON "EquityState"("account_number");

-- CreateIndex
CREATE INDEX "WorkingOrder_account_id_symbol_idx" ON "WorkingOrder"("account_id", "symbol");

-- CreateIndex
CREATE INDEX "WorkingOrder_account_id_report_date_idx" ON "WorkingOrder"("account_id", "report_date");

-- CreateIndex
CREATE UNIQUE INDEX "WorkingOrder_account_id_order_no_key" ON "WorkingOrder"("account_id", "order_no");

-- CreateIndex
CREATE UNIQUE INDEX "RiskMetricsSnapshot_account_id_timeframe_key" ON "RiskMetricsSnapshot"("account_id", "timeframe");

-- CreateIndex
CREATE UNIQUE INDEX "Strategy_magic_key" ON "Strategy"("magic");

-- AddForeignKey
ALTER TABLE "EquityState" ADD CONSTRAINT "EquityState_account_number_fkey" FOREIGN KEY ("account_number") REFERENCES "Account"("account_number") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionState" ADD CONSTRAINT "PositionState_account_number_position_id_fkey" FOREIGN KEY ("account_number", "position_id") REFERENCES "OpenPosition"("account_id", "position_no") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClosedPosition" ADD CONSTRAINT "ClosedPosition_account_number_fkey" FOREIGN KEY ("account_number") REFERENCES "Account"("account_number") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingOrder" ADD CONSTRAINT "WorkingOrder_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskMetricsSnapshot" ADD CONSTRAINT "RiskMetricsSnapshot_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
