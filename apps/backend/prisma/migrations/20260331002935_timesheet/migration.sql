-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "employmentStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "object_employee_assignments" (
    "id" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "object_employee_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheet_months" (
    "id" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timesheet_months_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheet_employee_rows" (
    "id" TEXT NOT NULL,
    "timesheetMonthId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "employeeNameSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timesheet_employee_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheet_day_entries" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "attendanceStatus" TEXT NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timesheet_day_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employees_employmentStatus_idx" ON "employees"("employmentStatus");

-- CreateIndex
CREATE INDEX "object_employee_assignments_objectId_idx" ON "object_employee_assignments"("objectId");

-- CreateIndex
CREATE INDEX "object_employee_assignments_employeeId_idx" ON "object_employee_assignments"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "object_employee_assignments_objectId_employeeId_key" ON "object_employee_assignments"("objectId", "employeeId");

-- CreateIndex
CREATE INDEX "timesheet_months_objectId_idx" ON "timesheet_months"("objectId");

-- CreateIndex
CREATE INDEX "timesheet_months_year_month_idx" ON "timesheet_months"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_months_objectId_year_month_key" ON "timesheet_months"("objectId", "year", "month");

-- CreateIndex
CREATE INDEX "timesheet_employee_rows_timesheetMonthId_idx" ON "timesheet_employee_rows"("timesheetMonthId");

-- CreateIndex
CREATE INDEX "timesheet_employee_rows_employeeId_idx" ON "timesheet_employee_rows"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_employee_rows_timesheetMonthId_employeeId_key" ON "timesheet_employee_rows"("timesheetMonthId", "employeeId");

-- CreateIndex
CREATE INDEX "timesheet_day_entries_rowId_idx" ON "timesheet_day_entries"("rowId");

-- CreateIndex
CREATE INDEX "timesheet_day_entries_dayOfMonth_idx" ON "timesheet_day_entries"("dayOfMonth");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_day_entries_rowId_dayOfMonth_key" ON "timesheet_day_entries"("rowId", "dayOfMonth");

-- AddForeignKey
ALTER TABLE "object_employee_assignments" ADD CONSTRAINT "object_employee_assignments_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_employee_assignments" ADD CONSTRAINT "object_employee_assignments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_months" ADD CONSTRAINT "timesheet_months_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_months" ADD CONSTRAINT "timesheet_months_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_employee_rows" ADD CONSTRAINT "timesheet_employee_rows_timesheetMonthId_fkey" FOREIGN KEY ("timesheetMonthId") REFERENCES "timesheet_months"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_employee_rows" ADD CONSTRAINT "timesheet_employee_rows_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_day_entries" ADD CONSTRAINT "timesheet_day_entries_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "timesheet_employee_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_day_entries" ADD CONSTRAINT "timesheet_day_entries_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_day_entries" ADD CONSTRAINT "timesheet_day_entries_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
