CREATE TABLE "user_absences" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "absenceType" TEXT NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "comment" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_absences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_absences_type_check" CHECK ("absenceType" IN ('vacation', 'sick_leave', 'day_off')),
  CONSTRAINT "user_absences_date_range_check" CHECK ("startDate" <= "endDate")
);

ALTER TABLE "user_absences"
  ADD CONSTRAINT "user_absences_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_absences"
  ADD CONSTRAINT "user_absences_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "user_absences_userId_startDate_endDate_idx"
  ON "user_absences"("userId", "startDate", "endDate");
CREATE INDEX "user_absences_startDate_endDate_idx"
  ON "user_absences"("startDate", "endDate");
CREATE INDEX "user_absences_absenceType_idx"
  ON "user_absences"("absenceType");

INSERT INTO "permissions" ("id", "code", "name", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::TEXT, 'user_absences.view_all', 'Просмотр отсутствий пользователей CRM', 'Просмотр графика отпусков, больничных и отгулов всех пользователей CRM', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'user_absences.manage', 'Управление отсутствиями пользователей CRM', 'Создание, изменение и удаление отпусков, больничных и отгулов пользователей CRM', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid()::TEXT, role_record."id", permission_record."id", CURRENT_TIMESTAMP
FROM (
  VALUES
    ('founder', 'user_absences.view_all'),
    ('deputy_founder', 'user_absences.view_all'),
    ('director', 'user_absences.view_all'),
    ('corporate_director', 'user_absences.view_all'),
    ('deputy_director', 'user_absences.view_all'),
    ('hr', 'user_absences.view_all'),
    ('founder', 'user_absences.manage'),
    ('deputy_founder', 'user_absences.manage'),
    ('director', 'user_absences.manage'),
    ('corporate_director', 'user_absences.manage'),
    ('deputy_director', 'user_absences.manage'),
    ('hr', 'user_absences.manage')
) AS binding("roleCode", "permissionCode")
JOIN "roles" role_record ON role_record."code" = binding."roleCode"
JOIN "permissions" permission_record ON permission_record."code" = binding."permissionCode"
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
