ALTER TABLE "object_arrival_photos"
ALTER COLUMN "photoUrl" DROP NOT NULL;

CREATE TABLE "one_time_order_daily_reports" (
    "id" TEXT NOT NULL,
    "oneTimeOrderId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "content" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "one_time_order_daily_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "one_time_order_photos" (
    "id" TEXT NOT NULL,
    "oneTimeOrderId" TEXT NOT NULL,
    "photoCategory" TEXT NOT NULL,
    "comment" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "one_time_order_photos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "one_time_order_daily_reports_oneTimeOrderId_reportDate_key"
ON "one_time_order_daily_reports"("oneTimeOrderId", "reportDate");

CREATE INDEX "one_time_order_daily_reports_oneTimeOrderId_reportDate_idx"
ON "one_time_order_daily_reports"("oneTimeOrderId", "reportDate");

CREATE INDEX "one_time_order_photos_oneTimeOrderId_createdAt_idx"
ON "one_time_order_photos"("oneTimeOrderId", "createdAt");

CREATE INDEX "one_time_order_photos_photoCategory_idx"
ON "one_time_order_photos"("photoCategory");

ALTER TABLE "one_time_order_daily_reports"
ADD CONSTRAINT "one_time_order_daily_reports_oneTimeOrderId_fkey"
FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "one_time_order_daily_reports"
ADD CONSTRAINT "one_time_order_daily_reports_updatedByUserId_fkey"
FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "one_time_order_photos"
ADD CONSTRAINT "one_time_order_photos_oneTimeOrderId_fkey"
FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "one_time_order_photos"
ADD CONSTRAINT "one_time_order_photos_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
