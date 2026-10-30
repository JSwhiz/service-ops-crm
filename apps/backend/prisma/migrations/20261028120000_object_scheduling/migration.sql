-- Additive only: legacy attendance remains one row per employee/object/day.
ALTER TABLE "object_attendance_facts" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'legacy';

CREATE TABLE "object_setup" (
  "objectId" TEXT NOT NULL PRIMARY KEY,
  "version" INTEGER NOT NULL DEFAULT 1,
  "data" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "object_setup_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "object_staff_positions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "objectId" TEXT NOT NULL,
  "clientKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "object_staff_positions_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "object_staff_positions_objectId_clientKey_key" ON "object_staff_positions"("objectId","clientKey");
CREATE TABLE "object_schedule_versions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "positionId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "name" TEXT NOT NULL,
  "headcount" INTEGER,
  "requiredPerShift" INTEGER NOT NULL DEFAULT 1,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "template" JSONB NOT NULL,
  "groups" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "object_schedule_versions_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "object_staff_positions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "object_schedule_versions_headcount_check" CHECK ("headcount" IS NULL OR "headcount" BETWEEN 0 AND 10000),
  CONSTRAINT "object_schedule_versions_demand_check" CHECK ("requiredPerShift" BETWEEN 1 AND 10000)
);
CREATE UNIQUE INDEX "object_schedule_versions_positionId_version_key" ON "object_schedule_versions"("positionId","version");
CREATE INDEX "object_schedule_versions_positionId_effectiveFrom_version_idx" ON "object_schedule_versions"("positionId","effectiveFrom","version");
CREATE TABLE "object_pay_contours" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "objectId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "dailyRate" INTEGER NOT NULL,
  "summerDailyRate" INTEGER,
  "winterDailyRate" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 1,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "effectiveFrom" DATE NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "object_pay_contours_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "object_pay_contours_rates_check" CHECK ("dailyRate" BETWEEN 0 AND 100000000 AND ("summerDailyRate" IS NULL OR "summerDailyRate" BETWEEN 0 AND 100000000) AND ("winterDailyRate" IS NULL OR "winterDailyRate" BETWEEN 0 AND 100000000))
);
CREATE UNIQUE INDEX "object_pay_contours_objectId_code_key" ON "object_pay_contours"("objectId","code");
CREATE TABLE "object_shift_attendance" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "objectId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "operationDate" DATE NOT NULL,
  "revisionId" TEXT NOT NULL,
  "groupKey" TEXT NOT NULL,
  "timeRangeKey" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "contourId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'confirmed',
  "version" INTEGER NOT NULL DEFAULT 1,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "dailyRateSnapshot" INTEGER NOT NULL,
  "ratePolicySnapshot" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledByUserId" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  CONSTRAINT "object_shift_attendance_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "object_shift_attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "object_shift_attendance_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "object_schedule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "object_shift_attendance_contourId_fkey" FOREIGN KEY ("contourId") REFERENCES "object_pay_contours"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "object_shift_attendance_objectId_requestKey_key" ON "object_shift_attendance"("objectId","requestKey");
CREATE UNIQUE INDEX "object_shift_attendance_revisionId_groupKey_timeRangeKey_emp_key" ON "object_shift_attendance"("revisionId","groupKey","timeRangeKey","employeeId","operationDate");
CREATE INDEX "object_shift_attendance_objectId_employeeId_operationDate_sta_idx" ON "object_shift_attendance"("objectId","employeeId","operationDate","status");

-- An explicit personal grant, never a role grant or a runtime name comparison.
INSERT INTO "permissions" ("id","code","name","description","createdAt","updatedAt")
VALUES (md5('permission:object.coefficient_edit'), 'object.coefficient_edit', 'Изменение коэффициента объекта', 'Персональное право хранения коэффициента без применения к начислениям', NOW(), NOW())
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "description" = EXCLUDED."description", "updatedAt" = NOW();
INSERT INTO "user_permissions" ("id","userId","permissionId","createdAt")
SELECT md5('object.coefficient_edit:' || u."id"), u."id", p."id", NOW()
FROM "users" u CROSS JOIN "permissions" p
WHERE u."login" IN ('lebedev','gerasimov') AND p."code" = 'object.coefficient_edit'
ON CONFLICT ("userId","permissionId") DO NOTHING;
