CREATE TABLE "one_time_order_employee_assignments" (
  "id" TEXT NOT NULL,
  "oneTimeOrderId" TEXT NOT NULL,
  "workCycle" INTEGER NOT NULL,
  "employeeId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "removedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "one_time_order_employee_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "one_time_order_attendance_submissions" (
  "id" TEXT NOT NULL,
  "oneTimeOrderId" TEXT NOT NULL,
  "workCycle" INTEGER NOT NULL,
  "operationDate" DATE NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedByUserId" TEXT NOT NULL,
  CONSTRAINT "one_time_order_attendance_submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "one_time_order_timesheet_day_entries" (
  "id" TEXT NOT NULL,
  "oneTimeOrderId" TEXT NOT NULL,
  "workCycle" INTEGER NOT NULL,
  "employeeId" TEXT NOT NULL,
  "operationDate" DATE NOT NULL,
  "attendancePresent" BOOLEAN NOT NULL,
  "rateSnapshot" DECIMAL(14,2) NOT NULL,
  "automaticValue" DECIMAL(14,2) NOT NULL,
  "finalValue" DECIMAL(14,2) NOT NULL,
  "manualOverride" BOOLEAN NOT NULL DEFAULT false,
  "manualReason" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "one_time_order_timesheet_day_entries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "one_time_order_employee_assignments"
  ADD CONSTRAINT "one_time_order_employee_assignments_order_fkey"
  FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "one_time_order_employee_assignments"
  ADD CONSTRAINT "one_time_order_employee_assignments_employee_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "one_time_order_employee_assignments"
  ADD CONSTRAINT "one_time_order_employee_assignments_created_by_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "one_time_order_employee_assignments"
  ADD CONSTRAINT "one_time_order_employee_assignments_removed_by_fkey"
  FOREIGN KEY ("removedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "one_time_order_attendance_submissions"
  ADD CONSTRAINT "one_time_order_attendance_submissions_order_fkey"
  FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "one_time_order_attendance_submissions"
  ADD CONSTRAINT "one_time_order_attendance_submissions_submitted_by_fkey"
  FOREIGN KEY ("submittedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "one_time_order_timesheet_day_entries"
  ADD CONSTRAINT "one_time_order_timesheet_day_entries_order_fkey"
  FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "one_time_order_timesheet_day_entries"
  ADD CONSTRAINT "one_time_order_timesheet_day_entries_employee_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "one_time_order_timesheet_day_entries"
  ADD CONSTRAINT "one_time_order_timesheet_day_entries_created_by_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "one_time_order_timesheet_day_entries"
  ADD CONSTRAINT "one_time_order_timesheet_day_entries_updated_by_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "one_time_order_employee_assignment_cycle_employee_key"
  ON "one_time_order_employee_assignments"("oneTimeOrderId", "workCycle", "employeeId");
CREATE INDEX "one_time_order_employee_assignment_active_idx"
  ON "one_time_order_employee_assignments"("oneTimeOrderId", "workCycle", "isActive");
CREATE INDEX "one_time_order_employee_assignment_employee_idx"
  ON "one_time_order_employee_assignments"("employeeId");

CREATE UNIQUE INDEX "one_time_order_attendance_submission_day_key"
  ON "one_time_order_attendance_submissions"("oneTimeOrderId", "workCycle", "operationDate");
CREATE INDEX "one_time_order_attendance_submission_date_idx"
  ON "one_time_order_attendance_submissions"("operationDate");

CREATE UNIQUE INDEX "one_time_order_timesheet_day_entry_key"
  ON "one_time_order_timesheet_day_entries"("oneTimeOrderId", "workCycle", "employeeId", "operationDate");
CREATE INDEX "one_time_order_timesheet_order_date_idx"
  ON "one_time_order_timesheet_day_entries"("oneTimeOrderId", "workCycle", "operationDate");
CREATE INDEX "one_time_order_timesheet_employee_date_idx"
  ON "one_time_order_timesheet_day_entries"("employeeId", "operationDate");
