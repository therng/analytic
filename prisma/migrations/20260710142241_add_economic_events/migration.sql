-- CreateTable
CREATE TABLE "EconomicEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "event_time" TIMESTAMP(3) NOT NULL,
    "event_hour_bucket" INTEGER NOT NULL,
    "impact" TEXT NOT NULL,
    "forecast" TEXT,
    "previous" TEXT,
    "actual" TEXT,
    "actual_fetched_at" TIMESTAMP(3),
    "last_polled_at" TIMESTAMP(3) NOT NULL,
    "poll_attempts" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EconomicEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EconomicEvent_event_time_idx" ON "EconomicEvent"("event_time");

-- CreateIndex
CREATE UNIQUE INDEX "EconomicEvent_currency_name_event_hour_bucket_key" ON "EconomicEvent"("currency", "name", "event_hour_bucket");
