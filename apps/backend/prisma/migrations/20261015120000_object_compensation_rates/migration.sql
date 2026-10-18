ALTER TABLE "objects"
  ADD COLUMN "paymentScheduleCode" TEXT,
  ADD COLUMN "paymentScheduleWeekdays" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "summerScheduleCode" TEXT,
  ADD COLUMN "summerScheduleWeekdays" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "winterScheduleCode" TEXT,
  ADD COLUMN "winterScheduleWeekdays" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "object_employee_assignments" ADD COLUMN "ratePolicyWeekdays" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE TABLE "object_compensation_rates" (
  "id" TEXT NOT NULL,
  "objectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'standard',
  "ratePolicyType" TEXT NOT NULL,
  "baseAmount" INTEGER NOT NULL,
  "scheduleCode" TEXT,
  "scheduleWeekdays" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "standardShiftHours" DOUBLE PRECISION NOT NULL DEFAULT 8,
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "effectiveTo" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "object_compensation_rates_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "object_employee_assignments"
  ADD COLUMN "rateOptionId" TEXT;

CREATE UNIQUE INDEX "object_compensation_rates_objectId_name_key"
  ON "object_compensation_rates"("objectId", "name");
CREATE INDEX "object_compensation_rates_objectId_category_isActive_idx"
  ON "object_compensation_rates"("objectId", "category", "isActive");
CREATE INDEX "object_compensation_rates_effectiveFrom_effectiveTo_idx"
  ON "object_compensation_rates"("effectiveFrom", "effectiveTo");
CREATE INDEX "object_employee_assignments_rateOptionId_idx"
  ON "object_employee_assignments"("rateOptionId");

ALTER TABLE "object_compensation_rates"
  ADD CONSTRAINT "object_compensation_rates_objectId_fkey"
  FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "object_employee_assignments"
  ADD CONSTRAINT "object_employee_assignments_rateOptionId_fkey"
  FOREIGN KEY ("rateOptionId") REFERENCES "object_compensation_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
