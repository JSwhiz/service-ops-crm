-- Object payroll source moves from manually maintained daily rate to monthly salary.
-- Legacy dailyRate remains in storage for compatibility with historical snapshots and old integrations,
-- but new Object UX and automatic fallback calculations use monthlySalary.
ALTER TABLE "objects"
  ADD COLUMN "monthlySalary" INTEGER NOT NULL DEFAULT 0;

-- The previous schema accidentally declared an index on a non-existent Object.objectId.
-- Counterparty is the nullable Object relation introduced in Wave 3.5.
CREATE INDEX IF NOT EXISTS "objects_counterpartyId_idx"
  ON "objects"("counterpartyId");
