INSERT INTO "permissions" ("id", "code", "name", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::TEXT,
  'one_time_order.review.view_all',
  'Просмотр отзывов всех разовых заказов',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "updatedAt" = CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'deputy_director') THEN
    RAISE EXCEPTION 'Required canonical role deputy_director is missing';
  END IF;
END $$;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId", "createdAt")
SELECT
  gen_random_uuid()::TEXT,
  role."id",
  permission."id",
  CURRENT_TIMESTAMP
FROM "roles" role
CROSS JOIN "permissions" permission
WHERE role."code" = 'deputy_director'
  AND permission."code" = 'one_time_order.review.view_all'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
