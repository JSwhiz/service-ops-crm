ALTER TABLE "user_absences"
  ADD COLUMN "updatedByUserId" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "deletedByUserId" TEXT;

ALTER TABLE "user_absences"
  ADD CONSTRAINT "user_absences_updatedByUserId_fkey"
  FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "user_absences_deletedByUserId_fkey"
  FOREIGN KEY ("deletedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "user_absences_deletedAt_idx" ON "user_absences"("deletedAt");

INSERT INTO "permissions" ("id", "code", "name", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::TEXT, 'user_absences.view_private_reasons', 'Просмотр причин отсутствия', 'Просмотр комментариев и причин отсутствия пользователей', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = CURRENT_TIMESTAMP;

-- Cross-user access is personal to Kireeva only. No role receives global
-- user-calendar permissions, regardless of seniority or HR membership.
DELETE FROM "role_permissions" rp
USING "permissions" p
WHERE rp."permissionId" = p."id"
  AND p."code" IN (
    'user_absences.view_all',
    'user_absences.manage',
    'user_absences.view_private_reasons'
  );

-- Remove explicit cross-user calendar grants from everyone except Kireeva.
DELETE FROM "user_permissions" up
USING "permissions" p, "users" u
WHERE up."permissionId" = p."id"
  AND up."userId" = u."id"
  AND u."login" <> 'kireeva'
  AND p."code" IN (
    'user_absences.view_all',
    'user_absences.manage',
    'user_absences.view_private_reasons'
  );

-- Give the named HR User an addressable personal grant, not a role-wide bypass.
INSERT INTO "user_permissions" ("id", "userId", "permissionId", "createdAt")
SELECT gen_random_uuid()::TEXT, u."id", p."id", CURRENT_TIMESTAMP
FROM "users" u
CROSS JOIN "permissions" p
WHERE u."login" = 'kireeva'
  AND p."code" IN (
    'user_absences.view_all',
    'user_absences.manage',
    'user_absences.view_private_reasons'
  )
ON CONFLICT ("userId", "permissionId") DO NOTHING;
