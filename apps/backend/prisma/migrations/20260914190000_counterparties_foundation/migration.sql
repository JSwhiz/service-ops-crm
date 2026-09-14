-- Counterparty is a customer/legal entity and is intentionally separate from Object.
CREATE TABLE "counterparties" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "legalName" TEXT,
  "contactName" TEXT,
  "contactPhone" TEXT,
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "counterparties_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "counterparties_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "counterparties_name_idx" ON "counterparties"("name");
CREATE INDEX "counterparties_legalName_idx" ON "counterparties"("legalName");
CREATE INDEX "counterparties_status_idx" ON "counterparties"("status");
CREATE INDEX "counterparties_createdByUserId_idx" ON "counterparties"("createdByUserId");
CREATE INDEX "counterparties_updatedAt_idx" ON "counterparties"("updatedAt");

ALTER TABLE "objects" ADD COLUMN "counterpartyId" TEXT;
ALTER TABLE "objects"
  ADD CONSTRAINT "objects_counterpartyId_fkey"
  FOREIGN KEY ("counterpartyId") REFERENCES "counterparties"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "objects_counterpartyId_idx" ON "objects"("counterpartyId");

INSERT INTO "permissions" ("id", "code", "name", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::TEXT, 'counterparties.view', 'Просмотр контрагентов', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'counterparties.manage', 'Создание, редактирование и архивация контрагентов', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'counterparties.link_objects', 'Привязка объектов к контрагентам', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid()::TEXT, r."id", p."id", CURRENT_TIMESTAMP
FROM (
  VALUES
    ('founder', 'counterparties.view'),
    ('deputy_founder', 'counterparties.view'),
    ('director', 'counterparties.view'),
    ('corporate_director', 'counterparties.view'),
    ('deputy_director', 'counterparties.view'),
    ('hr', 'counterparties.view'),
    ('operation_manager', 'counterparties.view'),
    ('manager', 'counterparties.view'),
    ('founder', 'counterparties.manage'),
    ('deputy_founder', 'counterparties.manage'),
    ('director', 'counterparties.manage'),
    ('corporate_director', 'counterparties.manage'),
    ('deputy_director', 'counterparties.manage'),
    ('founder', 'counterparties.link_objects'),
    ('deputy_founder', 'counterparties.link_objects'),
    ('director', 'counterparties.link_objects'),
    ('corporate_director', 'counterparties.link_objects'),
    ('deputy_director', 'counterparties.link_objects')
) AS binding("roleCode", "permissionCode")
JOIN "roles" r ON r."code" = binding."roleCode"
JOIN "permissions" p ON p."code" = binding."permissionCode"
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
