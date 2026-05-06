ALTER TABLE "object_employee_assignments"
ADD COLUMN "ratePolicyType" TEXT NOT NULL DEFAULT 'daily_rate',
ADD COLUMN "ratePolicyBaseAmount" INTEGER,
ADD COLUMN "ratePolicyScheduleCode" TEXT,
ADD COLUMN "ratePolicyRoundingMode" TEXT,
ADD COLUMN "ratePolicyRoundingStep" INTEGER,
ADD COLUMN "ratePolicyStandardShiftHours" DOUBLE PRECISION,
ADD COLUMN "ratePolicyWorkingDaysInMonth" INTEGER,
ADD COLUMN "ratePolicyExcludedHolidayDays" INTEGER,
ADD COLUMN "ratePolicyNotes" TEXT,
ADD COLUMN "ratePolicyUpdatedByUserId" TEXT,
ADD COLUMN "ratePolicyUpdatedAt" TIMESTAMP(3);

ALTER TABLE "timesheet_day_entries"
ADD COLUMN "autoValue" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "manualValue" INTEGER,
ADD COLUMN "difference" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "workedHours" DOUBLE PRECISION,
ADD COLUMN "ratePolicySnapshot" JSONB,
ADD COLUMN "calculationExplanation" TEXT;

UPDATE "timesheet_day_entries"
SET
  "autoValue" = "dayValue",
  "manualValue" = CASE WHEN "isChangedManually" THEN "dayValue" ELSE NULL END,
  "difference" = 0;

ALTER TABLE "object_attendance_facts"
ADD COLUMN "workedHours" DOUBLE PRECISION,
ADD COLUMN "ratePolicySnapshot" JSONB,
ADD COLUMN "calculationExplanation" TEXT;

CREATE INDEX "object_employee_assignments_ratePolicyType_idx"
ON "object_employee_assignments"("ratePolicyType");
