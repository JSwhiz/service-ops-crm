-- Additive opt-in rollout only. Intentionally no UPDATE/INSERT of legacy data.
CREATE TABLE "object_compensation_versions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "objectId" TEXT NOT NULL REFERENCES "objects"("id") ON DELETE CASCADE,
  "scope" TEXT NOT NULL CHECK ("scope" IN ('contour', 'rate', 'defaults')),
  "scopeId" TEXT NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "requestKey" TEXT NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "terms" JSONB NOT NULL,
  "createdByUserId" TEXT NOT NULL REFERENCES "users"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMP(3),
  "cancelledByUserId" TEXT REFERENCES "users"("id"),
  "cancelReason" TEXT
);
CREATE UNIQUE INDEX "object_compensation_versions_objectId_requestKey_key" ON "object_compensation_versions"("objectId", "requestKey");
CREATE UNIQUE INDEX "object_compensation_versions_objectId_scope_scopeId_version_key" ON "object_compensation_versions"("objectId", "scope", "scopeId", "version");
CREATE INDEX "object_compensation_versions_objectId_scope_scopeId_effectiveFrom_idx" ON "object_compensation_versions"("objectId", "scope", "scopeId", "effectiveFrom");
CREATE UNIQUE INDEX "object_compensation_versions_live_date_key" ON "object_compensation_versions"("objectId", "scope", "scopeId", "effectiveFrom") WHERE "cancelledAt" IS NULL;

CREATE TABLE "object_team_fund_versions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "objectId" TEXT NOT NULL REFERENCES "objects"("id") ON DELETE CASCADE,
  "version" INTEGER NOT NULL CHECK ("version" > 0),
  "requestKey" TEXT NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "monthlyAmount" INTEGER NOT NULL CHECK ("monthlyAmount" >= 0),
  "allocations" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL REFERENCES "users"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "object_team_fund_versions_objectId_requestKey_key" ON "object_team_fund_versions"("objectId", "requestKey");
CREATE UNIQUE INDEX "object_team_fund_versions_objectId_version_key" ON "object_team_fund_versions"("objectId", "version");
CREATE UNIQUE INDEX "object_team_fund_versions_objectId_effectiveFrom_key" ON "object_team_fund_versions"("objectId", "effectiveFrom");

CREATE TABLE "object_compensation_adjustments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "objectId" TEXT NOT NULL REFERENCES "objects"("id") ON DELETE CASCADE,
  "requestKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "operationDate" DATE NOT NULL,
  "employeeId" TEXT REFERENCES "employees"("id"),
  "attendanceId" TEXT REFERENCES "object_shift_attendance"("id"),
  "amount" INTEGER CHECK ("amount" >= 0),
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "payload" JSONB NOT NULL,
  "beforeSnapshot" JSONB NOT NULL,
  "afterSnapshot" JSONB,
  "createdByUserId" TEXT NOT NULL REFERENCES "users"("id"),
  "appliedByUserId" TEXT REFERENCES "users"("id"),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appliedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "object_compensation_adjustments_objectId_requestKey_key" ON "object_compensation_adjustments"("objectId", "requestKey");
CREATE INDEX "object_compensation_adjustments_objectId_operationDate_status_idx" ON "object_compensation_adjustments"("objectId", "operationDate", "status");

CREATE TABLE "object_payroll_credits" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "objectId" TEXT NOT NULL REFERENCES "objects"("id") ON DELETE CASCADE,
  "employeeId" TEXT NOT NULL REFERENCES "employees"("id"),
  "operationDate" DATE NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "policySnapshot" JSONB NOT NULL,
  "explanation" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL REFERENCES "users"("id"),
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "object_payroll_credits_objectId_sourceKey_key" ON "object_payroll_credits"("objectId", "sourceKey");
CREATE INDEX "object_payroll_credits_objectId_employeeId_operationDate_idx" ON "object_payroll_credits"("objectId", "employeeId", "operationDate");
