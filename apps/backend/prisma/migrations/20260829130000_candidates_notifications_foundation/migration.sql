-- Candidate is independent from both User and Employee.
CREATE TABLE "candidates" (
  "id" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "phone" TEXT,
  "comment" TEXT,
  "candidateType" TEXT NOT NULL DEFAULT 'regular',
  "status" TEXT NOT NULL DEFAULT 'new',
  "createdByUserId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "candidates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "candidates_candidateType_check" CHECK ("candidateType" IN ('regular', 'reserve')),
  CONSTRAINT "candidates_status_check" CHECK ("status" IN ('new', 'in_progress', 'accepted', 'rejected')),
  CONSTRAINT "candidates_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "candidate_manager_assignments" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "managerUserId" TEXT NOT NULL,
  "assignedByUserId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "responseDueAt" TIMESTAMP(3) NOT NULL,
  "firstRespondedAt" TIMESTAMP(3),
  "reminderSentAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "endedByUserId" TEXT,
  CONSTRAINT "candidate_manager_assignments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "candidate_manager_assignments_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "candidate_manager_assignments_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "candidate_manager_assignments_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "candidate_manager_assignments_endedByUserId_fkey" FOREIGN KEY ("endedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "candidate_responses" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "assignmentId" TEXT,
  "authorUserId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "candidate_responses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "candidate_responses_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "candidate_responses_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "candidate_manager_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "candidate_responses_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "notifications" (
  "id" TEXT NOT NULL,
  "recipientUserId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  "targetUrl" TEXT,
  "dedupeKey" TEXT,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "candidates_fullName_idx" ON "candidates"("fullName");
CREATE INDEX "candidates_phone_idx" ON "candidates"("phone");
CREATE INDEX "candidates_candidateType_idx" ON "candidates"("candidateType");
CREATE INDEX "candidates_status_idx" ON "candidates"("status");
CREATE INDEX "candidates_createdByUserId_idx" ON "candidates"("createdByUserId");
CREATE INDEX "candidates_deletedAt_idx" ON "candidates"("deletedAt");
CREATE INDEX "candidates_updatedAt_idx" ON "candidates"("updatedAt");
CREATE INDEX "candidate_manager_assignments_candidateId_assignedAt_idx" ON "candidate_manager_assignments"("candidateId", "assignedAt");
CREATE INDEX "candidate_manager_assignments_managerUserId_endedAt_idx" ON "candidate_manager_assignments"("managerUserId", "endedAt");
CREATE INDEX "candidate_manager_assignments_responseDueAt_firstRespondedAt_reminderSentAt_endedAt_idx" ON "candidate_manager_assignments"("responseDueAt", "firstRespondedAt", "reminderSentAt", "endedAt");
CREATE INDEX "candidate_manager_assignments_assignedByUserId_idx" ON "candidate_manager_assignments"("assignedByUserId");
CREATE INDEX "candidate_manager_assignments_endedByUserId_idx" ON "candidate_manager_assignments"("endedByUserId");
CREATE UNIQUE INDEX "candidate_manager_assignments_one_active_idx" ON "candidate_manager_assignments"("candidateId") WHERE "endedAt" IS NULL;
CREATE INDEX "candidate_responses_candidateId_createdAt_idx" ON "candidate_responses"("candidateId", "createdAt");
CREATE INDEX "candidate_responses_assignmentId_idx" ON "candidate_responses"("assignmentId");
CREATE INDEX "candidate_responses_authorUserId_idx" ON "candidate_responses"("authorUserId");
CREATE UNIQUE INDEX "notifications_recipientUserId_dedupeKey_key" ON "notifications"("recipientUserId", "dedupeKey");
CREATE INDEX "notifications_recipientUserId_readAt_createdAt_idx" ON "notifications"("recipientUserId", "readAt", "createdAt");
CREATE INDEX "notifications_entityType_entityId_idx" ON "notifications"("entityType", "entityId");

-- Canonical permissions are production data and cannot depend on seed.
INSERT INTO "roles" ("id", "code", "name", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::TEXT, 'founder', 'Учредитель', 'Системная роль учредителя', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'deputy_founder', 'Заместитель учредителя', 'Системная роль заместителя учредителя', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'director', 'Директор', 'Системная роль директора', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'corporate_director', 'Корпоративный директор', 'Системная роль корпоративного директора', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'deputy_director', 'Заместитель директора', 'Системная роль заместителя директора', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'hr', 'HR', 'Системная роль HR-контура', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'operation_manager', 'Операционный менеджер', 'Системная роль операционного менеджера', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'manager', 'Менеджер', 'Системная роль менеджера', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "permissions" ("id", "code", "name", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::TEXT, 'candidates.view', 'Просмотр кандидатов', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'candidates.manage', 'Управление кандидатами', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'candidates.respond', 'Ответы по кандидатам', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid()::TEXT, role_record."id", permission_record."id", CURRENT_TIMESTAMP
FROM (
  VALUES
    ('founder', 'candidates.view'), ('deputy_founder', 'candidates.view'),
    ('director', 'candidates.view'), ('corporate_director', 'candidates.view'),
    ('deputy_director', 'candidates.view'), ('hr', 'candidates.view'),
    ('operation_manager', 'candidates.view'), ('manager', 'candidates.view'),
    ('founder', 'candidates.manage'), ('deputy_founder', 'candidates.manage'),
    ('director', 'candidates.manage'), ('corporate_director', 'candidates.manage'),
    ('deputy_director', 'candidates.manage'), ('hr', 'candidates.manage'),
    ('operation_manager', 'candidates.respond'), ('manager', 'candidates.respond')
) AS binding("roleCode", "permissionCode")
JOIN "roles" role_record ON role_record."code" = binding."roleCode"
JOIN "permissions" permission_record ON permission_record."code" = binding."permissionCode"
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('founder', 'candidates.view'), ('deputy_founder', 'candidates.view'),
        ('director', 'candidates.view'), ('corporate_director', 'candidates.view'),
        ('deputy_director', 'candidates.view'), ('hr', 'candidates.view'),
        ('operation_manager', 'candidates.view'), ('manager', 'candidates.view'),
        ('founder', 'candidates.manage'), ('deputy_founder', 'candidates.manage'),
        ('director', 'candidates.manage'), ('corporate_director', 'candidates.manage'),
        ('deputy_director', 'candidates.manage'), ('hr', 'candidates.manage'),
        ('operation_manager', 'candidates.respond'), ('manager', 'candidates.respond')
    ) AS expected("roleCode", "permissionCode")
    LEFT JOIN "roles" role_record ON role_record."code" = expected."roleCode"
    LEFT JOIN "permissions" permission_record ON permission_record."code" = expected."permissionCode"
    LEFT JOIN "role_permissions" binding
      ON binding."roleId" = role_record."id"
      AND binding."permissionId" = permission_record."id"
    WHERE binding."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Canonical candidate role permissions were not installed';
  END IF;
END $$;
