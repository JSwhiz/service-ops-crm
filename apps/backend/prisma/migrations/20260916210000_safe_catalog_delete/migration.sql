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
