-- CreateTable
CREATE TABLE "object_attendance_facts" (
    "id" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "operationDate" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "object_attendance_facts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "object_attendance_facts_objectId_operationDate_idx" ON "object_attendance_facts"("objectId", "operationDate");

-- CreateIndex
CREATE INDEX "object_attendance_facts_employeeId_operationDate_idx" ON "object_attendance_facts"("employeeId", "operationDate");

-- CreateIndex
CREATE UNIQUE INDEX "object_attendance_facts_objectId_employeeId_operationDate_key" ON "object_attendance_facts"("objectId", "employeeId", "operationDate");

-- AddForeignKey
ALTER TABLE "object_attendance_facts" ADD CONSTRAINT "object_attendance_facts_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_attendance_facts" ADD CONSTRAINT "object_attendance_facts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "object_attendance_facts" ADD CONSTRAINT "object_attendance_facts_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
