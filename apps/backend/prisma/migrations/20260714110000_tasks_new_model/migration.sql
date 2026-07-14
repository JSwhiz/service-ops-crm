-- Extend the task aggregate while preserving the legacy result fields for compatibility.
ALTER TABLE "tasks"
    ADD COLUMN "dueAt" TIMESTAMP(3),
    ADD COLUMN "dueTimeSpecified" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "requiresConfirmation" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "completionRequirement" TEXT NOT NULL DEFAULT 'comment_or_file',
    ADD COLUMN "autoCloseAt" TIMESTAMP(3),
    ADD COLUMN "completedAt" TIMESTAMP(3),
    ADD COLUMN "completedByUserId" TEXT,
    ADD COLUMN "completedByKind" TEXT,
    ADD COLUMN "cancelledAt" TIMESTAMP(3),
    ADD COLUMN "cancelledByUserId" TEXT,
    ADD COLUMN "cancellationReason" TEXT,
    ADD COLUMN "workCycle" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "visibilityMode" TEXT NOT NULL DEFAULT 'scope';

ALTER TABLE "task_assignees"
    ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "removedAt" TIMESTAMP(3),
    ADD COLUMN "removedByUserId" TEXT;

CREATE TABLE "task_assignee_completions" (
    "id" TEXT NOT NULL,
    "taskAssigneeId" TEXT NOT NULL,
    "workCycle" INTEGER NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "completionText" TEXT,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_assignee_completions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_visibility_users" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_visibility_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_history_events" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "eventType" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_history_events_pkey" PRIMARY KEY ("id")
);

-- Existing result submissions are assigned only when the legacy submitter is an assignee.
INSERT INTO "task_assignee_completions" (
    "id",
    "taskAssigneeId",
    "workCycle",
    "attemptNumber",
    "completionText",
    "status",
    "source",
    "submittedAt",
    "cancelledAt",
    "cancellationReason",
    "createdAt",
    "updatedAt"
)
SELECT
    gen_random_uuid()::TEXT,
    assignee."id",
    1,
    1,
    task."resultText",
    CASE
        WHEN task."status" IN ('awaiting_confirmation', 'closed') THEN 'submitted'
        ELSE 'cancelled'
    END,
    'legacy',
    COALESCE(task."submittedAt", task."updatedAt"),
    CASE
        WHEN task."status" IN ('awaiting_confirmation', 'closed') THEN NULL
        ELSE task."updatedAt"
    END,
    CASE
        WHEN task."status" IN ('awaiting_confirmation', 'closed') THEN NULL
        ELSE 'Migrated from legacy task state'
    END,
    COALESCE(task."submittedAt", task."updatedAt"),
    task."updatedAt"
FROM "tasks" task
JOIN "task_assignees" assignee
    ON assignee."taskId" = task."id"
    AND assignee."userId" = task."submittedByUserId"
WHERE task."resultText" IS NOT NULL OR task."submittedAt" IS NOT NULL;

UPDATE "task_assignees" assignee
SET
    "isCompleted" = true,
    "completedAt" = completion."submittedAt"
FROM "task_assignee_completions" completion
WHERE completion."taskAssigneeId" = assignee."id"
  AND completion."status" = 'submitted';

-- Preserve every legacy result in structured history, including submissions by non-assignees.
INSERT INTO "task_history_events" (
    "id",
    "taskId",
    "actorUserId",
    "eventType",
    "payload",
    "createdAt"
)
SELECT
    gen_random_uuid()::TEXT,
    task."id",
    task."submittedByUserId",
    'task.legacy_result_migrated',
    jsonb_build_object(
        'resultText', task."resultText",
        'submittedAt', task."submittedAt",
        'legacyStatus', task."status"
    ),
    COALESCE(task."submittedAt", task."updatedAt")
FROM "tasks" task
WHERE task."resultText" IS NOT NULL OR task."submittedAt" IS NOT NULL;

UPDATE "tasks"
SET
    "completedAt" = COALESCE("submittedAt", "updatedAt"),
    "completedByUserId" = "submittedByUserId",
    "completedByKind" = 'legacy'
WHERE "status" = 'closed';

UPDATE "tasks"
SET "status" = CASE
    WHEN "status" IN ('assigned', 'partially_completed', 'returned_to_work') THEN 'in_progress'
    WHEN "status" = 'closed' THEN 'completed'
    ELSE "status"
END;

-- Legacy result submission always required text.
UPDATE "tasks"
SET "completionRequirement" = 'comment_required'
WHERE "resultText" IS NOT NULL OR "submittedAt" IS NOT NULL;

UPDATE "tasks"
SET "visibilityMode" = 'selected'
WHERE "objectId" IS NULL AND "oneTimeOrderId" IS NULL;

CREATE INDEX "tasks_dueAt_idx" ON "tasks"("dueAt");
CREATE INDEX "tasks_autoCloseAt_idx" ON "tasks"("autoCloseAt");
CREATE INDEX "task_assignees_taskId_isActive_idx" ON "task_assignees"("taskId", "isActive");
CREATE UNIQUE INDEX "task_completion_assignment_cycle_attempt_key"
    ON "task_assignee_completions"("taskAssigneeId", "workCycle", "attemptNumber");
CREATE INDEX "task_completion_assignment_cycle_idx"
    ON "task_assignee_completions"("taskAssigneeId", "workCycle");
CREATE INDEX "task_assignee_completions_status_idx" ON "task_assignee_completions"("status");
CREATE UNIQUE INDEX "task_assignee_completions_one_submitted_per_cycle_idx"
    ON "task_assignee_completions"("taskAssigneeId", "workCycle")
    WHERE "status" = 'submitted';
CREATE UNIQUE INDEX "task_visibility_users_taskId_userId_key"
    ON "task_visibility_users"("taskId", "userId");
CREATE INDEX "task_visibility_users_taskId_idx" ON "task_visibility_users"("taskId");
CREATE INDEX "task_visibility_users_userId_idx" ON "task_visibility_users"("userId");
CREATE INDEX "task_history_events_taskId_createdAt_idx" ON "task_history_events"("taskId", "createdAt");
CREATE INDEX "task_history_events_actorUserId_idx" ON "task_history_events"("actorUserId");
CREATE INDEX "task_history_events_eventType_idx" ON "task_history_events"("eventType");

ALTER TABLE "tasks"
    ADD CONSTRAINT "tasks_completedByUserId_fkey"
    FOREIGN KEY ("completedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "tasks_cancelledByUserId_fkey"
    FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "task_assignees"
    ADD CONSTRAINT "task_assignees_removedByUserId_fkey"
    FOREIGN KEY ("removedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "task_assignee_completions"
    ADD CONSTRAINT "task_assignee_completions_taskAssigneeId_fkey"
    FOREIGN KEY ("taskAssigneeId") REFERENCES "task_assignees"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "task_assignee_completions_cancelledByUserId_fkey"
    FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "task_visibility_users"
    ADD CONSTRAINT "task_visibility_users_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "task_visibility_users_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "task_visibility_users_addedByUserId_fkey"
    FOREIGN KEY ("addedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_history_events"
    ADD CONSTRAINT "task_history_events_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "task_history_events_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
