ALTER TABLE "one_time_orders"
ADD COLUMN "executionStartDate" DATE,
ADD COLUMN "executionEndDate" DATE;

UPDATE "one_time_orders"
SET
    "executionStartDate" = (("executionDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::DATE,
    "executionEndDate" = (("executionDate" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::DATE
WHERE "executionDate" IS NOT NULL;

CREATE INDEX "one_time_orders_executionStartDate_idx" ON "one_time_orders"("executionStartDate");
CREATE INDEX "one_time_orders_executionEndDate_idx" ON "one_time_orders"("executionEndDate");
