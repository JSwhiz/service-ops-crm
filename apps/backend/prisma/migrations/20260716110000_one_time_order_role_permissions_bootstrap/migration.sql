-- One-time order permissions must not depend on the development seed.
INSERT INTO "roles" ("id", "code", "name", "description", "createdAt", "updatedAt")
VALUES
    (gen_random_uuid()::TEXT, 'founder', 'Учредитель', 'Системная роль учредителя', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::TEXT, 'deputy_founder', 'Заместитель учредителя', 'Системная роль заместителя учредителя', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::TEXT, 'director', 'Директор', 'Системная роль директора', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::TEXT, 'corporate_director', 'Корпоративный директор', 'Системная роль корпоративного директора', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::TEXT, 'hr', 'HR', 'Системная роль HR-контура', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

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

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
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
        ) AS expected("roleCode", "permissionCode")
        LEFT JOIN "roles" role_record ON role_record."code" = expected."roleCode"
        LEFT JOIN "permissions" permission_record ON permission_record."code" = expected."permissionCode"
        LEFT JOIN "role_permissions" binding
            ON binding."roleId" = role_record."id"
            AND binding."permissionId" = permission_record."id"
        WHERE binding."id" IS NULL
    ) THEN
        RAISE EXCEPTION 'Canonical one-time-order role permissions were not installed';
    END IF;
END $$;
