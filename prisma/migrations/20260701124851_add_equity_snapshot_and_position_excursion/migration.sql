-- CreateTable
CREATE TABLE "EquitySnapshot" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "equity" DECIMAL(28,8) NOT NULL,
    "margin" DECIMAL(28,8) NOT NULL,
    "balance" DECIMAL(28,8) NOT NULL,

    CONSTRAINT "EquitySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionExcursion" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "position_ticket" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "profit" DECIMAL(28,8) NOT NULL,

    CONSTRAINT "PositionExcursion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EquitySnapshot_account_id_ts_idx" ON "EquitySnapshot"("account_id", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "EquitySnapshot_account_id_ts_key" ON "EquitySnapshot"("account_id", "ts");

-- CreateIndex
CREATE INDEX "PositionExcursion_account_id_position_ticket_ts_idx" ON "PositionExcursion"("account_id", "position_ticket", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "PositionExcursion_account_id_position_ticket_ts_key" ON "PositionExcursion"("account_id", "position_ticket", "ts");

-- AddForeignKey
ALTER TABLE "EquitySnapshot" ADD CONSTRAINT "EquitySnapshot_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionExcursion" ADD CONSTRAINT "PositionExcursion_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
