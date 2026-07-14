ALTER TABLE "one_time_orders"
  ADD COLUMN "reviewText" TEXT,
  ADD COLUMN "reviewRating" INTEGER,
  ADD COLUMN "reviewUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "reviewUpdatedByUserId" TEXT;

ALTER TABLE "one_time_orders"
  ADD CONSTRAINT "one_time_orders_reviewRating_check"
  CHECK ("reviewRating" IS NULL OR "reviewRating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "one_time_orders_reviewUpdatedByUserId_fkey"
  FOREIGN KEY ("reviewUpdatedByUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "one_time_orders_reviewUpdatedByUserId_idx"
  ON "one_time_orders"("reviewUpdatedByUserId");
