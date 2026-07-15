CREATE TABLE "one_time_manager_availability" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "requestComment" TEXT,
    "resolutionComment" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "one_time_manager_availability_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "one_time_manager_availability_date_range_check" CHECK ("endDate" >= "startDate"),
    CONSTRAINT "one_time_manager_availability_entry_type_check" CHECK ("entryType" IN ('day_off', 'vacation', 'sick_leave')),
    CONSTRAINT "one_time_manager_availability_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled'))
);

CREATE INDEX "one_time_manager_availability_userId_startDate_endDate_idx"
    ON "one_time_manager_availability"("userId", "startDate", "endDate");
CREATE INDEX "one_time_manager_availability_status_startDate_idx"
    ON "one_time_manager_availability"("status", "startDate");
CREATE INDEX "one_time_manager_availability_requestedByUserId_idx"
    ON "one_time_manager_availability"("requestedByUserId");
CREATE INDEX "one_time_manager_availability_resolvedByUserId_idx"
    ON "one_time_manager_availability"("resolvedByUserId");
CREATE INDEX "one_time_manager_availability_cancelledByUserId_idx"
    ON "one_time_manager_availability"("cancelledByUserId");

ALTER TABLE "one_time_manager_availability"
    ADD CONSTRAINT "one_time_manager_availability_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "one_time_manager_availability"
    ADD CONSTRAINT "one_time_manager_availability_requestedByUserId_fkey"
    FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "one_time_manager_availability"
    ADD CONSTRAINT "one_time_manager_availability_resolvedByUserId_fkey"
    FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "one_time_manager_availability"
    ADD CONSTRAINT "one_time_manager_availability_cancelledByUserId_fkey"
    FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
