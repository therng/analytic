-- CreateTable
CREATE TABLE "AccountPerformanceBySymbol" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "net_profit" DECIMAL(28,8) NOT NULL,
    "trades" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "total_volume" DOUBLE PRECISION NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountPerformanceBySymbol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountPerformanceByStrategy" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "magic" INTEGER NOT NULL,
    "net_profit" DECIMAL(28,8) NOT NULL,
    "trades" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "total_volume" DOUBLE PRECISION NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountPerformanceByStrategy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountPerformanceBySymbol_account_id_idx" ON "AccountPerformanceBySymbol"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "AccountPerformanceBySymbol_account_id_symbol_key" ON "AccountPerformanceBySymbol"("account_id", "symbol");

-- CreateIndex
CREATE INDEX "AccountPerformanceByStrategy_account_id_idx" ON "AccountPerformanceByStrategy"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "AccountPerformanceByStrategy_account_id_magic_key" ON "AccountPerformanceByStrategy"("account_id", "magic");

-- AddForeignKey
ALTER TABLE "AccountPerformanceBySymbol" ADD CONSTRAINT "AccountPerformanceBySymbol_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountPerformanceByStrategy" ADD CONSTRAINT "AccountPerformanceByStrategy_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
