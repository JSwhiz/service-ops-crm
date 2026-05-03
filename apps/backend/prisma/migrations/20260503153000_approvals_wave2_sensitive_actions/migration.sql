ALTER TABLE "inventory_movements"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'applied';

CREATE INDEX "inventory_movements_status_idx" ON "inventory_movements"("status");

ALTER TABLE "equipment_movements"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'applied';

CREATE INDEX "equipment_movements_status_idx" ON "equipment_movements"("status");

CREATE TABLE "timesheet_manual_exceptions" (
    "id" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "requestedDayValue" INTEGER NOT NULL,
    "currentDayValueSnapshot" INTEGER NOT NULL,
    "comment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedByUserId" TEXT NOT NULL,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timesheet_manual_exceptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "timesheet_manual_exceptions_objectId_year_month_idx" ON "timesheet_manual_exceptions"("objectId", "year", "month");
CREATE INDEX "timesheet_manual_exceptions_employeeId_year_month_idx" ON "timesheet_manual_exceptions"("employeeId", "year", "month");
CREATE INDEX "timesheet_manual_exceptions_status_idx" ON "timesheet_manual_exceptions"("status");
CREATE INDEX "timesheet_manual_exceptions_requestedByUserId_idx" ON "timesheet_manual_exceptions"("requestedByUserId");
CREATE INDEX "timesheet_manual_exceptions_resolvedByUserId_idx" ON "timesheet_manual_exceptions"("resolvedByUserId");

ALTER TABLE "timesheet_manual_exceptions"
ADD CONSTRAINT "timesheet_manual_exceptions_objectId_fkey"
FOREIGN KEY ("objectId") REFERENCES "objects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "timesheet_manual_exceptions"
ADD CONSTRAINT "timesheet_manual_exceptions_employeeId_fkey"
FOREIGN KEY ("employeeId") REFERENCES "employees"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "timesheet_manual_exceptions"
ADD CONSTRAINT "timesheet_manual_exceptions_requestedByUserId_fkey"
FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "timesheet_manual_exceptions"
ADD CONSTRAINT "timesheet_manual_exceptions_resolvedByUserId_fkey"
FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
