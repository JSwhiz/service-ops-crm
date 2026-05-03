CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "approvalType" TEXT NOT NULL,
    "sourceEntityType" TEXT NOT NULL,
    "sourceEntityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdByUserId" TEXT NOT NULL,
    "resolvedByUserId" TEXT,
    "cancelledByUserId" TEXT,
    "decisionComment" TEXT,
    "payloadSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "approval_requests_status_createdAt_idx" ON "approval_requests"("status", "createdAt");
CREATE INDEX "approval_requests_approvalType_status_idx" ON "approval_requests"("approvalType", "status");
CREATE INDEX "approval_requests_sourceEntityType_sourceEntityId_idx" ON "approval_requests"("sourceEntityType", "sourceEntityId");
CREATE INDEX "approval_requests_createdByUserId_idx" ON "approval_requests"("createdByUserId");
CREATE INDEX "approval_requests_resolvedByUserId_idx" ON "approval_requests"("resolvedByUserId");
CREATE INDEX "approval_requests_cancelledByUserId_idx" ON "approval_requests"("cancelledByUserId");

ALTER TABLE "approval_requests"
ADD CONSTRAINT "approval_requests_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "approval_requests"
ADD CONSTRAINT "approval_requests_resolvedByUserId_fkey"
FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "approval_requests"
ADD CONSTRAINT "approval_requests_cancelledByUserId_fkey"
FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
