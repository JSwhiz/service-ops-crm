BEGIN;

ALTER TABLE "one_time_order_specification_templates"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "one_time_orders"
  ADD COLUMN "creationRequestId" TEXT,
  ADD COLUMN "creationRequestFingerprint" TEXT;

CREATE UNIQUE INDEX "one_time_orders_createdByUserId_creationRequestId_key"
  ON "one_time_orders"("createdByUserId", "creationRequestId");

COMMIT;
