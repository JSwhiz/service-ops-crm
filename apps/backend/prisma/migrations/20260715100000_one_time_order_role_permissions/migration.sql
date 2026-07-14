CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "role_permissions_roleId_idx" ON "role_permissions"("roleId");
CREATE INDEX "role_permissions_permissionId_idx" ON "role_permissions"("permissionId");
CREATE UNIQUE INDEX "role_permissions_roleId_permissionId_key" ON "role_permissions"("roleId", "permissionId");

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey"
FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey"
FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "permissions" ("id", "code", "name", "createdAt", "updatedAt")
VALUES
    (gen_random_uuid()::TEXT, 'one_time_order.review.edit', 'Редактирование отзывов разовых заказов', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::TEXT, 'one_time_order.calendar.approve_availability', 'Подтверждение доступности менеджеров разовых заказов', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::TEXT, 'one_time_order.calendar.manage', 'Управление календарём разовых заказов', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::TEXT, 'one_time_order.manage_all', 'Полное управление разовыми заказами', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
    "name" = EXCLUDED."name",
    "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId", "createdAt")
SELECT
    gen_random_uuid()::TEXT,
    role_record."id",
    permission_record."id",
    CURRENT_TIMESTAMP
FROM (
    VALUES
        ('founder', 'one_time_order.review.edit'),
        ('deputy_founder', 'one_time_order.review.edit'),
        ('director', 'one_time_order.review.edit'),
        ('corporate_director', 'one_time_order.review.edit'),
        ('founder', 'one_time_order.manage_all'),
        ('deputy_founder', 'one_time_order.manage_all'),
        ('director', 'one_time_order.manage_all'),
        ('corporate_director', 'one_time_order.manage_all'),
        ('founder', 'one_time_order.calendar.approve_availability'),
        ('deputy_founder', 'one_time_order.calendar.approve_availability'),
        ('director', 'one_time_order.calendar.approve_availability'),
        ('corporate_director', 'one_time_order.calendar.approve_availability'),
        ('hr', 'one_time_order.calendar.approve_availability'),
        ('founder', 'one_time_order.calendar.manage'),
        ('deputy_founder', 'one_time_order.calendar.manage'),
        ('director', 'one_time_order.calendar.manage'),
        ('corporate_director', 'one_time_order.calendar.manage'),
        ('hr', 'one_time_order.calendar.manage')
) AS binding("roleCode", "permissionCode")
JOIN "roles" role_record ON role_record."code" = binding."roleCode"
JOIN "permissions" permission_record ON permission_record."code" = binding."permissionCode"
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
