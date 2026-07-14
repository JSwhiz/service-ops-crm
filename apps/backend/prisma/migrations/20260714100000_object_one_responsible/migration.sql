WITH ranked_responsibles AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "objectId"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, "id" DESC
    ) AS "position"
  FROM "object_assignments"
  WHERE "assignmentRoleCode" = 'responsible'
    AND "isActive" = TRUE
)
UPDATE "object_assignments" AS assignment
SET
  "isActive" = FALSE,
  "updatedAt" = CURRENT_TIMESTAMP
FROM ranked_responsibles
WHERE assignment."id" = ranked_responsibles."id"
  AND ranked_responsibles."position" > 1;

CREATE UNIQUE INDEX "object_assignments_one_active_responsible_idx"
ON "object_assignments"("objectId")
WHERE "assignmentRoleCode" = 'responsible'
  AND "isActive" = TRUE;
