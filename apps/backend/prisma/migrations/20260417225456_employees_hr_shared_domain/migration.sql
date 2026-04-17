-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "baseDailyRate" INTEGER,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "residenceAddress" TEXT,
ADD COLUMN     "shiftPreferences" TEXT;

-- CreateTable
CREATE TABLE "employee_object_assignment_history" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "closedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_object_assignment_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_availability_windows" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "availabilityStatus" TEXT NOT NULL,
    "comment" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_availability_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_substitutions" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "substituteEmployeeId" TEXT NOT NULL,
    "objectId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "comment" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_substitutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_object_assignment_history_employeeId_idx" ON "employee_object_assignment_history"("employeeId");

-- CreateIndex
CREATE INDEX "employee_object_assignment_history_objectId_idx" ON "employee_object_assignment_history"("objectId");

-- CreateIndex
CREATE INDEX "employee_object_assignment_history_endedAt_idx" ON "employee_object_assignment_history"("endedAt");

-- CreateIndex
CREATE INDEX "employee_availability_windows_employeeId_startDate_idx" ON "employee_availability_windows"("employeeId", "startDate");

-- CreateIndex
CREATE INDEX "employee_availability_windows_availabilityStatus_idx" ON "employee_availability_windows"("availabilityStatus");

-- CreateIndex
CREATE INDEX "employee_substitutions_employeeId_startDate_idx" ON "employee_substitutions"("employeeId", "startDate");

-- CreateIndex
CREATE INDEX "employee_substitutions_substituteEmployeeId_startDate_idx" ON "employee_substitutions"("substituteEmployeeId", "startDate");

-- CreateIndex
CREATE INDEX "employee_substitutions_objectId_idx" ON "employee_substitutions"("objectId");

-- CreateIndex
CREATE INDEX "employee_substitutions_status_idx" ON "employee_substitutions"("status");

-- AddForeignKey
ALTER TABLE "employee_object_assignment_history" ADD CONSTRAINT "employee_object_assignment_history_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_object_assignment_history" ADD CONSTRAINT "employee_object_assignment_history_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_object_assignment_history" ADD CONSTRAINT "employee_object_assignment_history_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_object_assignment_history" ADD CONSTRAINT "employee_object_assignment_history_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_availability_windows" ADD CONSTRAINT "employee_availability_windows_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_availability_windows" ADD CONSTRAINT "employee_availability_windows_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_substitutions" ADD CONSTRAINT "employee_substitutions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_substitutions" ADD CONSTRAINT "employee_substitutions_substituteEmployeeId_fkey" FOREIGN KEY ("substituteEmployeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_substitutions" ADD CONSTRAINT "employee_substitutions_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_substitutions" ADD CONSTRAINT "employee_substitutions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
