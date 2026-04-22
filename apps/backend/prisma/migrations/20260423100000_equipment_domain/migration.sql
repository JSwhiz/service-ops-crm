CREATE TABLE "equipment_catalog_items" (
  "id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "brand" TEXT,
  "model" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "equipment_catalog_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "equipment_units" (
  "id" TEXT NOT NULL,
  "catalogItemId" TEXT NOT NULL,
  "inventoryNumber" TEXT NOT NULL,
  "serialNumber" TEXT,
  "status" TEXT NOT NULL DEFAULT 'in_storage',
  "currentObjectId" TEXT,
  "currentOneTimeOrderId" TEXT,
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "equipment_units_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "equipment_movements" (
  "id" TEXT NOT NULL,
  "equipmentUnitId" TEXT NOT NULL,
  "movementType" TEXT NOT NULL,
  "fromObjectId" TEXT,
  "toObjectId" TEXT,
  "fromOneTimeOrderId" TEXT,
  "toOneTimeOrderId" TEXT,
  "fromStatus" TEXT,
  "toStatus" TEXT NOT NULL,
  "comment" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "equipment_movements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "equipment_units_inventoryNumber_key" ON "equipment_units"("inventoryNumber");
CREATE INDEX "equipment_catalog_items_category_idx" ON "equipment_catalog_items"("category");
CREATE INDEX "equipment_catalog_items_isActive_idx" ON "equipment_catalog_items"("isActive");
CREATE INDEX "equipment_catalog_items_createdByUserId_idx" ON "equipment_catalog_items"("createdByUserId");
CREATE INDEX "equipment_units_catalogItemId_idx" ON "equipment_units"("catalogItemId");
CREATE INDEX "equipment_units_status_idx" ON "equipment_units"("status");
CREATE INDEX "equipment_units_currentObjectId_idx" ON "equipment_units"("currentObjectId");
CREATE INDEX "equipment_units_currentOneTimeOrderId_idx" ON "equipment_units"("currentOneTimeOrderId");
CREATE INDEX "equipment_units_createdByUserId_idx" ON "equipment_units"("createdByUserId");
CREATE INDEX "equipment_movements_equipmentUnitId_idx" ON "equipment_movements"("equipmentUnitId");
CREATE INDEX "equipment_movements_movementType_idx" ON "equipment_movements"("movementType");
CREATE INDEX "equipment_movements_fromObjectId_idx" ON "equipment_movements"("fromObjectId");
CREATE INDEX "equipment_movements_toObjectId_idx" ON "equipment_movements"("toObjectId");
CREATE INDEX "equipment_movements_fromOneTimeOrderId_idx" ON "equipment_movements"("fromOneTimeOrderId");
CREATE INDEX "equipment_movements_toOneTimeOrderId_idx" ON "equipment_movements"("toOneTimeOrderId");
CREATE INDEX "equipment_movements_createdByUserId_idx" ON "equipment_movements"("createdByUserId");
CREATE INDEX "equipment_movements_createdAt_idx" ON "equipment_movements"("createdAt");

ALTER TABLE "equipment_catalog_items"
  ADD CONSTRAINT "equipment_catalog_items_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "equipment_units"
  ADD CONSTRAINT "equipment_units_catalogItemId_fkey"
  FOREIGN KEY ("catalogItemId") REFERENCES "equipment_catalog_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "equipment_units"
  ADD CONSTRAINT "equipment_units_currentObjectId_fkey"
  FOREIGN KEY ("currentObjectId") REFERENCES "objects"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "equipment_units"
  ADD CONSTRAINT "equipment_units_currentOneTimeOrderId_fkey"
  FOREIGN KEY ("currentOneTimeOrderId") REFERENCES "one_time_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "equipment_units"
  ADD CONSTRAINT "equipment_units_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "equipment_movements"
  ADD CONSTRAINT "equipment_movements_equipmentUnitId_fkey"
  FOREIGN KEY ("equipmentUnitId") REFERENCES "equipment_units"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "equipment_movements"
  ADD CONSTRAINT "equipment_movements_fromObjectId_fkey"
  FOREIGN KEY ("fromObjectId") REFERENCES "objects"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "equipment_movements"
  ADD CONSTRAINT "equipment_movements_toObjectId_fkey"
  FOREIGN KEY ("toObjectId") REFERENCES "objects"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "equipment_movements"
  ADD CONSTRAINT "equipment_movements_fromOneTimeOrderId_fkey"
  FOREIGN KEY ("fromOneTimeOrderId") REFERENCES "one_time_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "equipment_movements"
  ADD CONSTRAINT "equipment_movements_toOneTimeOrderId_fkey"
  FOREIGN KEY ("toOneTimeOrderId") REFERENCES "one_time_orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "equipment_movements"
  ADD CONSTRAINT "equipment_movements_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
