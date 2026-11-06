-- Additive only: no legacy grants, assignments, or financial facts are rewritten.
ALTER TABLE "users" ADD COLUMN "accessVersion" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "user_access_rules" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "actionCode" TEXT NOT NULL,
  "effect" TEXT NOT NULL, "scope" TEXT NOT NULL, "selectedIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_access_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_access_rules_effect_check" CHECK ("effect" IN ('allow','deny')),
  CONSTRAINT "user_access_rules_scope_check" CHECK ("scope" IN ('own','assigned','selected','all')),
  CONSTRAINT "user_access_rules_selection_check" CHECK (("scope" = 'selected' AND cardinality("selectedIds") > 0) OR ("scope" <> 'selected' AND cardinality("selectedIds") = 0)),
  CONSTRAINT "user_access_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_access_rules_userId_actionCode_key" ON "user_access_rules"("userId","actionCode");
CREATE INDEX "user_access_rules_actionCode_idx" ON "user_access_rules"("actionCode");
CREATE TABLE "user_access_audit" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "actorUserId" TEXT NOT NULL,
  "versionBefore" INTEGER NOT NULL, "versionAfter" INTEGER NOT NULL,
  "reason" TEXT NOT NULL, "before" JSONB NOT NULL, "after" JSONB NOT NULL, "changes" JSONB NOT NULL,
  "previewHash" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_access_audit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_access_audit_version_check" CHECK ("versionAfter" = "versionBefore" + 1),
  CONSTRAINT "user_access_audit_reason_check" CHECK (length(trim("reason")) > 0),
  CONSTRAINT "user_access_audit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "user_access_audit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_access_audit_userId_versionAfter_key" ON "user_access_audit"("userId","versionAfter");
CREATE INDEX "user_access_audit_userId_createdAt_idx" ON "user_access_audit"("userId","createdAt");
CREATE TABLE "user_access_previews" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "actorUserId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL, "previewHash" TEXT NOT NULL, "expectedVersion" INTEGER NOT NULL,
  "baseHash" TEXT NOT NULL, "payload" JSONB NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_access_previews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_access_previews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "user_access_previews_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_access_previews_tokenHash_key" ON "user_access_previews"("tokenHash");
CREATE INDEX "user_access_previews_userId_expiresAt_idx" ON "user_access_previews"("userId","expiresAt");
