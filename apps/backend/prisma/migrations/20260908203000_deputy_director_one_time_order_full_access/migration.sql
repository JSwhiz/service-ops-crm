-- Deputy director receives complete access inside the one-time-order domain only.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM "roles" WHERE "code" = 'deputy_director') THEN
        RAISE EXCEPTION 'Required canonical role deputy_director is missing';
    END IF;
END $$;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId", "createdAt")
SELECT
    gen_random_uuid()::TEXT,
    role_record."id",
    permission_record."id",
    CURRENT_TIMESTAMP
FROM (
    VALUES
        ('one_time_order.manage_all'),
        ('one_time_order.review.edit'),
        ('one_time_order.review.view_all'),
        ('one_time_order.calendar.approve_availability'),
        ('one_time_order.calendar.manage'),
        ('accountability.correct_receipt')
) AS expected("permissionCode")
JOIN "roles" role_record
    ON role_record."code" = 'deputy_director'
JOIN "permissions" permission_record
    ON permission_record."code" = expected."permissionCode"
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM (
            VALUES
                ('one_time_order.manage_all'),
                ('one_time_order.review.edit'),
                ('one_time_order.review.view_all'),
                ('one_time_order.calendar.approve_availability'),
                ('one_time_order.calendar.manage'),
                ('accountability.correct_receipt')
        ) AS expected("permissionCode")
        LEFT JOIN "roles" role_record
            ON role_record."code" = 'deputy_director'
        LEFT JOIN "permissions" permission_record
            ON permission_record."code" = expected."permissionCode"
        LEFT JOIN "role_permissions" binding
            ON binding."roleId" = role_record."id"
            AND binding."permissionId" = permission_record."id"
        WHERE binding."id" IS NULL
    ) THEN
        RAISE EXCEPTION 'Deputy director one-time-order permissions were not installed';
    END IF;
END $$;
