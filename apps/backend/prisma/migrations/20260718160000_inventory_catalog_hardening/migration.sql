ALTER TABLE "inventory_items"
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF EXISTS (
        WITH duplicate_groups AS (
            SELECT
                lower(btrim("name")) AS normalized_name,
                lower(btrim("category")) AS normalized_category,
                lower(btrim("unit")) AS normalized_unit
            FROM "inventory_items"
            WHERE "isActive" = true
            GROUP BY
                lower(btrim("name")),
                lower(btrim("category")),
                lower(btrim("unit"))
            HAVING COUNT(*) > 1
        )
        SELECT 1
        FROM "inventory_items" AS item
        INNER JOIN duplicate_groups AS duplicate_group
            ON lower(btrim(item."name")) = duplicate_group.normalized_name
           AND lower(btrim(item."category")) = duplicate_group.normalized_category
           AND lower(btrim(item."unit")) = duplicate_group.normalized_unit
        WHERE item."isActive" = true
          AND EXISTS (
              SELECT 1
              FROM "inventory_movements" AS movement
              WHERE movement."inventoryItemId" = item."id"
          )
    ) THEN
        RAISE EXCEPTION
            'Cannot normalize active inventory duplicates with movement history';
    END IF;
END;
$$;

WITH ranked_items AS (
    SELECT
        item.*,
        row_number() OVER (
            PARTITION BY
                lower(btrim(item."name")),
                lower(btrim(item."category")),
                lower(btrim(item."unit"))
            ORDER BY item."createdAt" ASC, item."id" ASC
        ) AS duplicate_rank
    FROM "inventory_items" AS item
    WHERE item."isActive" = true
), archive_candidates AS (
    SELECT *
    FROM ranked_items
    WHERE duplicate_rank > 1
)
INSERT INTO "audit_events" (
    "id",
    "actorUserId",
    "entityType",
    "entityId",
    "action",
    "oldValues",
    "newValues",
    "createdAt"
)
SELECT
    gen_random_uuid()::TEXT,
    NULL,
    'inventory_item',
    candidate."id",
    'inventory.item.duplicate_archived_by_migration',
    jsonb_build_object(
        'name', candidate."name",
        'category', candidate."category",
        'unit', candidate."unit",
        'notes', candidate."notes",
        'isActive', true,
        'version', candidate."version"
    ),
    jsonb_build_object(
        'name', candidate."name",
        'category', candidate."category",
        'unit', candidate."unit",
        'notes', candidate."notes",
        'isActive', false,
        'version', candidate."version" + 1
    ),
    CURRENT_TIMESTAMP
FROM archive_candidates AS candidate;

WITH ranked_items AS (
    SELECT
        item."id",
        row_number() OVER (
            PARTITION BY
                lower(btrim(item."name")),
                lower(btrim(item."category")),
                lower(btrim(item."unit"))
            ORDER BY item."createdAt" ASC, item."id" ASC
        ) AS duplicate_rank
    FROM "inventory_items" AS item
    WHERE item."isActive" = true
)
UPDATE "inventory_items" AS item
SET
    "isActive" = false,
    "version" = item."version" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
FROM ranked_items AS ranked
WHERE item."id" = ranked."id"
  AND ranked.duplicate_rank > 1;

CREATE UNIQUE INDEX "inventory_items_active_normalized_identity_key"
    ON "inventory_items" (
        lower(btrim("name")),
        lower(btrim("category")),
        lower(btrim("unit"))
    )
    WHERE "isActive" = true;
