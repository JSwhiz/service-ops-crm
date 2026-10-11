INSERT INTO "permissions" ("id", "code", "name", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::TEXT,
  'chat.room.close_global',
  'Глобальное закрытие групповых чатов',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "user_permissions" ("id", "userId", "permissionId", "createdAt")
SELECT
  gen_random_uuid()::TEXT,
  "users"."id",
  "permissions"."id",
  CURRENT_TIMESTAMP
FROM "users"
CROSS JOIN "permissions"
WHERE "users"."login" IN ('gerasimov', 'lebedev', 'stepanova')
  AND "permissions"."code" = 'chat.room.close_global'
ON CONFLICT ("userId", "permissionId") DO NOTHING;
