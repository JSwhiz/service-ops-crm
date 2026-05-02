CREATE TABLE "accountability_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accountability_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accountability_fundings" (
    "id" TEXT NOT NULL,
    "accountabilityAccountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "comment" TEXT,
    "issuedByUserId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accountability_fundings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accountability_expenses" (
    "id" TEXT NOT NULL,
    "accountabilityAccountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdByUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionComment" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accountability_expenses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accountability_closures" (
    "id" TEXT NOT NULL,
    "accountabilityAccountId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedByUserId" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accountability_closures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accountability_accounts_userId_key" ON "accountability_accounts"("userId");
CREATE INDEX "accountability_accounts_status_idx" ON "accountability_accounts"("status");
CREATE INDEX "accountability_fundings_accountabilityAccountId_issuedAt_idx" ON "accountability_fundings"("accountabilityAccountId", "issuedAt");
CREATE INDEX "accountability_fundings_issuedByUserId_idx" ON "accountability_fundings"("issuedByUserId");
CREATE INDEX "accountability_expenses_accountabilityAccountId_createdAt_idx" ON "accountability_expenses"("accountabilityAccountId", "createdAt");
CREATE INDEX "accountability_expenses_accountabilityAccountId_status_idx" ON "accountability_expenses"("accountabilityAccountId", "status");
CREATE INDEX "accountability_expenses_createdByUserId_idx" ON "accountability_expenses"("createdByUserId");
CREATE INDEX "accountability_expenses_approvedByUserId_idx" ON "accountability_expenses"("approvedByUserId");
CREATE INDEX "accountability_expenses_rejectedByUserId_idx" ON "accountability_expenses"("rejectedByUserId");
CREATE INDEX "accountability_closures_accountabilityAccountId_requestedAt_idx" ON "accountability_closures"("accountabilityAccountId", "requestedAt");
CREATE INDEX "accountability_closures_status_idx" ON "accountability_closures"("status");
CREATE INDEX "accountability_closures_requestedByUserId_idx" ON "accountability_closures"("requestedByUserId");
CREATE INDEX "accountability_closures_approvedByUserId_idx" ON "accountability_closures"("approvedByUserId");
CREATE INDEX "accountability_closures_rejectedByUserId_idx" ON "accountability_closures"("rejectedByUserId");

ALTER TABLE "accountability_accounts" ADD CONSTRAINT "accountability_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accountability_fundings" ADD CONSTRAINT "accountability_fundings_accountabilityAccountId_fkey" FOREIGN KEY ("accountabilityAccountId") REFERENCES "accountability_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accountability_fundings" ADD CONSTRAINT "accountability_fundings_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountability_expenses" ADD CONSTRAINT "accountability_expenses_accountabilityAccountId_fkey" FOREIGN KEY ("accountabilityAccountId") REFERENCES "accountability_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accountability_expenses" ADD CONSTRAINT "accountability_expenses_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountability_expenses" ADD CONSTRAINT "accountability_expenses_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accountability_expenses" ADD CONSTRAINT "accountability_expenses_rejectedByUserId_fkey" FOREIGN KEY ("rejectedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accountability_closures" ADD CONSTRAINT "accountability_closures_accountabilityAccountId_fkey" FOREIGN KEY ("accountabilityAccountId") REFERENCES "accountability_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accountability_closures" ADD CONSTRAINT "accountability_closures_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accountability_closures" ADD CONSTRAINT "accountability_closures_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accountability_closures" ADD CONSTRAINT "accountability_closures_rejectedByUserId_fkey" FOREIGN KEY ("rejectedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
