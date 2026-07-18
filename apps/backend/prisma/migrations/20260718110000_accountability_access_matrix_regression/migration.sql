-- Restore the pre-regression accountability matrix with explicit permissions.
INSERT INTO "permissions" ("id", "code", "name", "createdAt", "updatedAt")
VALUES
    (gen_random_uuid()::TEXT, 'accountability.issue_cash', 'Выдача подотчетных средств', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::TEXT, 'accountability.review', 'Административный просмотр подотчета', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::TEXT, 'expense.approve', 'Подтверждение расходов', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid()::TEXT, 'accountability.closure.approve', 'Подтверждение закрытия подотчета', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
        ('founder', 'accountability.issue_cash'),
        ('director', 'accountability.issue_cash'),
        ('founder', 'accountability.review'),
        ('deputy_founder', 'accountability.review'),
        ('director', 'accountability.review'),
        ('corporate_director', 'accountability.review'),
        ('founder', 'expense.approve'),
        ('deputy_founder', 'expense.approve'),
        ('director', 'expense.approve'),
        ('corporate_director', 'expense.approve'),
        ('founder', 'accountability.closure.approve'),
        ('deputy_founder', 'accountability.closure.approve'),
        ('director', 'accountability.closure.approve'),
        ('corporate_director', 'accountability.closure.approve')
) AS expected("roleCode", "permissionCode")
JOIN "roles" role_record ON role_record."code" = expected."roleCode"
JOIN "permissions" permission_record
    ON permission_record."code" = expected."permissionCode"
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM (
            VALUES
                ('founder', 'accountability.issue_cash'),
                ('director', 'accountability.issue_cash'),
                ('founder', 'accountability.review'),
                ('deputy_founder', 'accountability.review'),
                ('director', 'accountability.review'),
                ('corporate_director', 'accountability.review'),
                ('founder', 'expense.approve'),
                ('deputy_founder', 'expense.approve'),
                ('director', 'expense.approve'),
                ('corporate_director', 'expense.approve'),
                ('founder', 'accountability.closure.approve'),
                ('deputy_founder', 'accountability.closure.approve'),
                ('director', 'accountability.closure.approve'),
                ('corporate_director', 'accountability.closure.approve')
        ) AS expected("roleCode", "permissionCode")
        LEFT JOIN "roles" role_record
            ON role_record."code" = expected."roleCode"
        LEFT JOIN "permissions" permission_record
            ON permission_record."code" = expected."permissionCode"
        LEFT JOIN "role_permissions" binding
            ON binding."roleId" = role_record."id"
            AND binding."permissionId" = permission_record."id"
        WHERE binding."id" IS NULL
    ) THEN
        RAISE EXCEPTION 'Canonical accountability role permissions were not installed';
    END IF;
END $$;
