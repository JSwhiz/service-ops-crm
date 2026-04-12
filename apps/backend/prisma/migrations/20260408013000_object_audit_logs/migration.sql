CREATE TABLE "object_audit_logs" (
  "id" TEXT NOT NULL,
  "objectId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actionCode" TEXT NOT NULL,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "object_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "object_audit_logs_objectId_idx" ON "object_audit_logs"("objectId");
CREATE INDEX "object_audit_logs_actorUserId_idx" ON "object_audit_logs"("actorUserId");
CREATE INDEX "object_audit_logs_actionCode_idx" ON "object_audit_logs"("actionCode");
CREATE INDEX "object_audit_logs_createdAt_idx" ON "object_audit_logs"("createdAt");

ALTER TABLE "object_audit_logs"
ADD CONSTRAINT "object_audit_logs_objectId_fkey"
FOREIGN KEY ("objectId") REFERENCES "objects"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "object_audit_logs"
ADD CONSTRAINT "object_audit_logs_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
