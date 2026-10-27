INSERT INTO "permissions" ("id", "code", "name", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'candidates.denied', 'Персональный запрет доступа к кандидатам', NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "user_permissions" ("id", "userId", "permissionId", "createdAt")
SELECT gen_random_uuid()::text, u."id", p."id", NOW()
FROM "users" u CROSS JOIN "permissions" p
WHERE u."login" IN ('stepanova', 'nikitina') AND p."code" = 'candidates.denied'
ON CONFLICT ("userId", "permissionId") DO NOTHING;
