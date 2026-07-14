ALTER TABLE "one_time_order_photos"
ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedByUserId" TEXT,
ADD COLUMN "deleteReason" TEXT,
ADD COLUMN "restoredAt" TIMESTAMP(3),
ADD COLUMN "restoredByUserId" TEXT;

CREATE INDEX "one_time_order_photos_oneTimeOrderId_deletedAt_idx"
ON "one_time_order_photos"("oneTimeOrderId", "deletedAt");

CREATE INDEX "one_time_order_photos_deletedByUserId_idx"
ON "one_time_order_photos"("deletedByUserId");

CREATE INDEX "one_time_order_photos_restoredByUserId_idx"
ON "one_time_order_photos"("restoredByUserId");

ALTER TABLE "one_time_order_photos"
ADD CONSTRAINT "one_time_order_photos_deletedByUserId_fkey"
FOREIGN KEY ("deletedByUserId") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "one_time_order_photos"
ADD CONSTRAINT "one_time_order_photos_restoredByUserId_fkey"
FOREIGN KEY ("restoredByUserId") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
