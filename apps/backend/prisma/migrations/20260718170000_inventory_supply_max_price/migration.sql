CREATE OR REPLACE FUNCTION reconcile_inventory_current_unit_prices()
RETURNS void AS $$
BEGIN
    UPDATE "inventory_items" AS item
    SET "currentUnitPrice" = (
        SELECT MAX(movement."unitPriceSnapshot")
        FROM "inventory_movements" AS movement
        WHERE movement."inventoryItemId" = item."id"
          AND movement."movementType" = 'receipt'
          AND movement."status" = 'applied'
    );
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION reconcile_inventory_current_unit_prices() FROM PUBLIC;

SELECT reconcile_inventory_current_unit_prices();
