ALTER TABLE "inventory_items"
  ADD COLUMN "deletedByUserId" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

UPDATE "inventory_items"
SET "deletedAt" = COALESCE("updatedAt", CURRENT_TIMESTAMP)
WHERE "isActive" = false
  AND "deletedAt" IS NULL;

CREATE INDEX "inventory_items_deletedByUserId_idx"
  ON "inventory_items"("deletedByUserId");

CREATE INDEX "inventory_items_deletedAt_idx"
  ON "inventory_items"("deletedAt");

ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_deletedByUserId_fkey"
  FOREIGN KEY ("deletedByUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_movements"
  DROP CONSTRAINT "inventory_movements_inventoryItemId_fkey";

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_inventoryItemId_fkey"
  FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "equipment_movements"
  DROP CONSTRAINT "equipment_movements_equipmentUnitId_fkey";

ALTER TABLE "equipment_movements"
  ADD CONSTRAINT "equipment_movements_equipmentUnitId_fkey"
  FOREIGN KEY ("equipmentUnitId") REFERENCES "equipment_units"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("id","code","name","createdAt","updatedAt")
VALUES
  (gen_random_uuid()::TEXT,'inventory.catalog.delete','Удаление карточек расходников',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT,'equipment.unit.delete','Удаление ошибочно заведённого оборудования',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name", "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "user_permissions" ("id","userId","permissionId","createdAt")
SELECT gen_random_uuid()::TEXT, u."id", p."id", CURRENT_TIMESTAMP
FROM "users" u
CROSS JOIN "permissions" p
WHERE u."login" = 'gorbacheva'
  AND p."code" IN ('inventory.catalog.delete','equipment.unit.delete')
ON CONFLICT ("userId","permissionId") DO NOTHING;
