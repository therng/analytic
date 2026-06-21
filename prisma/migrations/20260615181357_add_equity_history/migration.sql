-- CreateTable
CREATE TABLE "EquityHistory" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "report_date" TIMESTAMP(3) NOT NULL,
    "equity" DECIMAL(28,8) NOT NULL,
    "balance" DECIMAL(28,8) NOT NULL,
    "floating_pl" DECIMAL(28,8) NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquityHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EquityHistory_account_id_report_date_idx" ON "EquityHistory"("account_id", "report_date");

-- CreateIndex
CREATE UNIQUE INDEX "EquityHistory_account_id_report_date_key" ON "EquityHistory"("account_id", "report_date");

-- AddForeignKey
ALTER TABLE "EquityHistory" ADD CONSTRAINT "EquityHistory_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
