ALTER TABLE "employees"
  ADD COLUMN "passportReceived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "passportReceivedAt" TIMESTAMP(3),
  ADD COLUMN "passportReceivedByUserId" TEXT,
  ADD COLUMN "contractReceived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "contractReceivedAt" TIMESTAMP(3),
  ADD COLUMN "contractReceivedByUserId" TEXT;

ALTER TABLE "candidates"
  ADD COLUMN "phones" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "phoneSearchText" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "employeeId" TEXT;

UPDATE "candidates" SET "phones" = ARRAY["phone"],
  "phoneSearchText" = regexp_replace("phone", '[^0-9]', '', 'g')
WHERE "phone" IS NOT NULL AND btrim("phone") <> '';

CREATE UNIQUE INDEX "candidates_employeeId_key" ON "candidates"("employeeId");
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "candidate_manager_assignments" ADD COLUMN "objectId" TEXT;
UPDATE "candidate_manager_assignments" a SET "objectId" = c."objectId"
FROM "candidates" c WHERE c."id" = a."candidateId";
ALTER TABLE "candidate_manager_assignments" ADD CONSTRAINT "candidate_manager_assignments_objectId_fkey"
  FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "candidate_manager_assignments_active_manager_key"
  ON "candidate_manager_assignments"("candidateId", "managerUserId") WHERE "endedAt" IS NULL;
