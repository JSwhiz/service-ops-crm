CREATE TABLE "user_substitutions" (
  "id" TEXT NOT NULL,
  "principalUserId" TEXT NOT NULL,
  "replacementUserId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokedByUserId" TEXT,
  "revocationReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_substitutions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_substitutions_not_self_check"
    CHECK ("principalUserId" <> "replacementUserId"),
  CONSTRAINT "user_substitutions_period_check"
    CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "user_substitutions_revocation_check"
    CHECK ("revokedAt" IS NOT NULL OR "revokedByUserId" IS NULL)
);

ALTER TABLE "user_substitutions"
  ADD CONSTRAINT "user_substitutions_principalUserId_fkey"
    FOREIGN KEY ("principalUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "user_substitutions_replacementUserId_fkey"
    FOREIGN KEY ("replacementUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "user_substitutions_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "user_substitutions_revokedByUserId_fkey"
    FOREIGN KEY ("revokedByUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "user_substitutions_principalUserId_startsAt_endsAt_idx"
  ON "user_substitutions"("principalUserId", "startsAt", "endsAt");
CREATE INDEX "user_substitutions_replacementUserId_startsAt_endsAt_idx"
  ON "user_substitutions"("replacementUserId", "startsAt", "endsAt");
CREATE INDEX "user_substitutions_revokedAt_idx"
  ON "user_substitutions"("revokedAt");

CREATE TABLE "user_substitution_objects" (
  "id" TEXT NOT NULL,
  "substitutionId" TEXT NOT NULL,
  "objectId" TEXT NOT NULL,
  CONSTRAINT "user_substitution_objects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_substitution_objects_substitutionId_objectId_key"
    UNIQUE ("substitutionId", "objectId"),
  CONSTRAINT "user_substitution_objects_substitutionId_fkey"
    FOREIGN KEY ("substitutionId") REFERENCES "user_substitutions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "user_substitution_objects_objectId_fkey"
    FOREIGN KEY ("objectId") REFERENCES "objects"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "user_substitution_objects_objectId_idx"
  ON "user_substitution_objects"("objectId");
