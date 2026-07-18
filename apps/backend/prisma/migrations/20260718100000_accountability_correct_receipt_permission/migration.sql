-- Receipt correction is intentionally narrower than general accountability review.
INSERT INTO "permissions" ("id", "code", "name", "createdAt", "updatedAt")
VALUES (
    gen_random_uuid()::TEXT,
    'accountability.correct_receipt',
    'Корректировка поступлений разовых заказов',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO UPDATE SET
    "name" = EXCLUDED."name",
    "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId", "createdAt")
SELECT
    gen_random_uuid()::TEXT,
    role_record."id",
    permission_record."id",
    CURRENT_TIMESTAMP
FROM (VALUES ('founder'), ('director')) AS expected("roleCode")
JOIN "roles" role_record ON role_record."code" = expected."roleCode"
JOIN "permissions" permission_record
    ON permission_record."code" = 'accountability.correct_receipt'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM (VALUES ('founder'), ('director')) AS expected("roleCode")
        LEFT JOIN "roles" role_record
            ON role_record."code" = expected."roleCode"
        LEFT JOIN "permissions" permission_record
            ON permission_record."code" = 'accountability.correct_receipt'
        LEFT JOIN "role_permissions" binding
            ON binding."roleId" = role_record."id"
            AND binding."permissionId" = permission_record."id"
        WHERE binding."id" IS NULL
    ) THEN
        RAISE EXCEPTION 'Canonical receipt correction permissions were not installed';
    END IF;
END $$;
