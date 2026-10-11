ALTER TABLE "tasks"
  ADD COLUMN "scopeType" TEXT NOT NULL DEFAULT 'personal',
  ADD COLUMN "visibilityType" TEXT NOT NULL DEFAULT 'private';

-- Preserve the effective reach of existing tasks while moving from the
-- legacy two-state flag to the explicit visibility model.
UPDATE "tasks" AS task
SET "scopeType" = CASE
      WHEN task."oneTimeOrderId" IS NOT NULL THEN 'one_time_order'
      WHEN task."objectId" IS NOT NULL THEN 'object'
      ELSE 'personal'
    END,
    "visibilityType" = CASE
      WHEN task."visibilityMode" = 'scope'
        AND (task."objectId" IS NOT NULL OR task."oneTimeOrderId" IS NOT NULL)
        THEN 'target_participants'
      WHEN task."visibilityMode" = 'selected'
        AND EXISTS (
          SELECT 1
          FROM "task_visibility_users" AS visible_user
          WHERE visible_user."taskId" = task.id
        )
        THEN 'selected_users'
      ELSE 'private'
    END;

CREATE INDEX "tasks_scopeType_idx" ON "tasks"("scopeType");
CREATE INDEX "tasks_visibilityType_idx" ON "tasks"("visibilityType");
