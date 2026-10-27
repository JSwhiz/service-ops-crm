BEGIN;

-- AlterTable
ALTER TABLE "employee_substitutions" ADD COLUMN     "rateOptionId" TEXT,
ADD COLUMN     "ratePolicySnapshot" JSONB;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "dismissedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "object_daily_reports" ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "submittedRevision" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "one_time_orders" ADD COLUMN     "deadlineAt" TIMESTAMP(3),
ADD COLUMN     "serviceLinesVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "object_daily_report_publications" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "object_daily_report_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manager_visit_plans" (
    "id" TEXT NOT NULL,
    "managerUserId" TEXT NOT NULL,
    "planDate" DATE NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "report" TEXT,
    "reportDueAt" TIMESTAMP(3),
    "reportClosedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manager_visit_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manager_visit_plan_entries" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "objectId" TEXT,
    "clientName" TEXT,
    "isUnplanned" BOOLEAN NOT NULL DEFAULT false,
    "visitedAt" TIMESTAMP(3),
    "visitReport" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manager_visit_plan_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one_time_order_escort_lists" (
    "id" TEXT NOT NULL,
    "oneTimeOrderId" TEXT NOT NULL,
    "escortUserId" TEXT NOT NULL,
    "operationDate" DATE NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "one_time_order_escort_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one_time_order_escort_employees" (
    "listId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,

    CONSTRAINT "one_time_order_escort_employees_pkey" PRIMARY KEY ("listId","employeeId")
);

-- CreateTable
CREATE TABLE "one_time_order_service_lines" (
    "id" TEXT NOT NULL,
    "oneTimeOrderId" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "one_time_order_service_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RubberMatSize" (
    "id" TEXT NOT NULL,
    "lengthCm" DECIMAL(10,2) NOT NULL,
    "widthCm" DECIMAL(10,2) NOT NULL,
    "replacementCost" DECIMAL(14,2),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RubberMatSize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RubberMatSizeChange" (
    "id" TEXT NOT NULL,
    "sizeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "beforeCost" DECIMAL(14,2),
    "afterCost" DECIMAL(14,2),
    "actorUserId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'user',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RubberMatSizeChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectRubberMatQuantity" (
    "objectId" TEXT NOT NULL,
    "sizeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObjectRubberMatQuantity_pkey" PRIMARY KEY ("objectId","sizeId")
);

-- CreateTable
CREATE TABLE "ObjectRubberMatQuantityChange" (
    "id" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "sizeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "beforeQuantity" INTEGER NOT NULL,
    "afterQuantity" INTEGER NOT NULL,
    "replacementCostSnapshot" DECIMAL(14,2),
    "actorUserId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'user',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObjectRubberMatQuantityChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RubberMatAggregateMigration" (
    "id" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RubberMatAggregateMigration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "object_daily_report_publications_publishedAt_createdAt_idx" ON "object_daily_report_publications"("publishedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "object_daily_report_publications_reportId_revision_key" ON "object_daily_report_publications"("reportId", "revision");

-- CreateIndex
CREATE INDEX "manager_visit_plans_reportDueAt_reportClosedAt_idx" ON "manager_visit_plans"("reportDueAt", "reportClosedAt");

-- CreateIndex
CREATE UNIQUE INDEX "manager_visit_plans_managerUserId_planDate_key" ON "manager_visit_plans"("managerUserId", "planDate");

-- CreateIndex
CREATE INDEX "manager_visit_plan_entries_planId_createdAt_idx" ON "manager_visit_plan_entries"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "manager_visit_plan_entries_objectId_idx" ON "manager_visit_plan_entries"("objectId");

-- CreateIndex
CREATE UNIQUE INDEX "one_time_order_escort_lists_oneTimeOrderId_escortUserId_ope_key" ON "one_time_order_escort_lists"("oneTimeOrderId", "escortUserId", "operationDate");

-- CreateIndex
CREATE INDEX "one_time_order_escort_employees_employeeId_idx" ON "one_time_order_escort_employees"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "one_time_order_service_lines_oneTimeOrderId_serviceCode_key" ON "one_time_order_service_lines"("oneTimeOrderId", "serviceCode");

-- CreateIndex
CREATE UNIQUE INDEX "RubberMatSize_lengthCm_widthCm_key" ON "RubberMatSize"("lengthCm", "widthCm");

-- CreateIndex
CREATE UNIQUE INDEX "RubberMatSizeChange_sizeId_version_key" ON "RubberMatSizeChange"("sizeId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectRubberMatQuantityChange_objectId_sizeId_version_key" ON "ObjectRubberMatQuantityChange"("objectId", "sizeId", "version");

-- AddForeignKey
ALTER TABLE "object_daily_report_publications" ADD CONSTRAINT "object_daily_report_publications_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "object_daily_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_visit_plans" ADD CONSTRAINT "manager_visit_plans_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_visit_plans" ADD CONSTRAINT "manager_visit_plans_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_visit_plan_entries" ADD CONSTRAINT "manager_visit_plan_entries_planId_fkey" FOREIGN KEY ("planId") REFERENCES "manager_visit_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_visit_plan_entries" ADD CONSTRAINT "manager_visit_plan_entries_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manager_visit_plan_entries" ADD CONSTRAINT "manager_visit_plan_entries_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_order_escort_lists" ADD CONSTRAINT "one_time_order_escort_lists_oneTimeOrderId_fkey" FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_order_escort_lists" ADD CONSTRAINT "one_time_order_escort_lists_escortUserId_fkey" FOREIGN KEY ("escortUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_order_escort_lists" ADD CONSTRAINT "one_time_order_escort_lists_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_order_escort_lists" ADD CONSTRAINT "one_time_order_escort_lists_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_order_escort_employees" ADD CONSTRAINT "one_time_order_escort_employees_listId_fkey" FOREIGN KEY ("listId") REFERENCES "one_time_order_escort_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_order_escort_employees" ADD CONSTRAINT "one_time_order_escort_employees_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_order_service_lines" ADD CONSTRAINT "one_time_order_service_lines_oneTimeOrderId_fkey" FOREIGN KEY ("oneTimeOrderId") REFERENCES "one_time_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_order_service_lines" ADD CONSTRAINT "one_time_order_service_lines_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_order_service_lines" ADD CONSTRAINT "one_time_order_service_lines_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve legacy history; establish the new quantity baseline exactly once.
ALTER TABLE "RubberMatSize" ADD CHECK ("lengthCm" > 0 AND "widthCm" > 0 AND ("replacementCost" IS NULL OR "replacementCost" >= 0) AND version > 0);
ALTER TABLE "ObjectRubberMatQuantity" ADD CHECK (quantity >= 0 AND version > 0);
ALTER TABLE "ObjectRubberMatQuantity" ADD FOREIGN KEY ("objectId") REFERENCES objects(id) ON DELETE RESTRICT;
ALTER TABLE "ObjectRubberMatQuantity" ADD FOREIGN KEY ("sizeId") REFERENCES "RubberMatSize"(id) ON DELETE RESTRICT;
ALTER TABLE "RubberMatSizeChange" ADD FOREIGN KEY ("sizeId") REFERENCES "RubberMatSize"(id) ON DELETE RESTRICT;
ALTER TABLE "RubberMatSizeChange" ADD FOREIGN KEY ("actorUserId") REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE "ObjectRubberMatQuantityChange" ADD FOREIGN KEY ("objectId") REFERENCES objects(id) ON DELETE RESTRICT;
ALTER TABLE "ObjectRubberMatQuantityChange" ADD FOREIGN KEY ("sizeId") REFERENCES "RubberMatSize"(id) ON DELETE RESTRICT;
ALTER TABLE "ObjectRubberMatQuantityChange" ADD FOREIGN KEY ("actorUserId") REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE "object_daily_report_publications" ADD FOREIGN KEY ("actorUserId") REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE "employee_substitutions" ADD FOREIGN KEY ("rateOptionId") REFERENCES object_compensation_rates(id) ON DELETE RESTRICT;
ALTER TABLE "object_daily_reports" ADD CHECK (revision > 0 AND "submittedRevision" >= 0 AND "submittedRevision" <= revision);
ALTER TABLE "manager_visit_plan_entries" ADD CHECK (("objectId" IS NOT NULL AND "clientName" IS NULL) OR ("objectId" IS NULL AND "clientName" IS NOT NULL AND length(trim("clientName")) > 0));
ALTER TABLE "one_time_order_service_lines" ADD CHECK ("serviceCode" IN ('cleaning', 'drycleaning') AND amount >= 0);

LOCK TABLE "rubber_mats" IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO "RubberMatSize" (id, "lengthCm", "widthCm", "replacementCost", version, "createdAt", "updatedAt")
SELECT 'legacy-size-' || md5("lengthCm"::text || ':' || "widthCm"::text), "lengthCm", "widthCm", NULL, 1, NOW(), NOW()
FROM "rubber_mats" GROUP BY "lengthCm", "widthCm" ON CONFLICT DO NOTHING;
INSERT INTO "RubberMatSizeChange" (id, "sizeId", version, "beforeCost", "afterCost", "actorUserId", source, "occurredAt")
SELECT 'legacy-size-change-' || id, id, 1, NULL, NULL, NULL, 'legacy_migration', NOW() FROM "RubberMatSize" ON CONFLICT DO NOTHING;
INSERT INTO "ObjectRubberMatQuantity" ("objectId", "sizeId", quantity, version, "updatedAt")
SELECT m."objectId", s.id, COUNT(*)::int, 1, NOW() FROM rubber_mats m JOIN "RubberMatSize" s ON s."lengthCm"=m."lengthCm" AND s."widthCm"=m."widthCm"
WHERE m."objectId" IS NOT NULL AND m.condition <> 'retired' GROUP BY m."objectId", s.id ON CONFLICT DO NOTHING;
INSERT INTO "ObjectRubberMatQuantityChange" (id, "objectId", "sizeId", version, "beforeQuantity", "afterQuantity", "replacementCostSnapshot", "actorUserId", source, "occurredAt")
SELECT 'legacy-quantity-' || md5(q."objectId" || ':' || q."sizeId"), q."objectId", q."sizeId", q.version, 0, q.quantity, NULL, NULL, 'legacy_migration', NOW() FROM "ObjectRubberMatQuantity" q ON CONFLICT DO NOTHING;
INSERT INTO "RubberMatAggregateMigration" (id) VALUES ('legacy-v1') ON CONFLICT DO NOTHING;

INSERT INTO permissions (id, code, name, "createdAt", "updatedAt") VALUES
 (gen_random_uuid()::text, 'objects.hr_reports_view', 'Просмотр отчётов и истории объектов', NOW(), NOW()),
 (gen_random_uuid()::text, 'visit_plans.manage', 'Управление дневными планами', NOW(), NOW()),
 (gen_random_uuid()::text, 'one_time_order.escorts.manage', 'Управление сопровождающими заказа', NOW(), NOW()),
 (gen_random_uuid()::text, 'chat.room.manage_members', 'Управление участниками групп', NOW(), NOW()) ON CONFLICT (code) DO NOTHING;
INSERT INTO user_permissions (id, "userId", "permissionId", "createdAt")
SELECT gen_random_uuid()::text, u.id, p.id, NOW() FROM users u CROSS JOIN permissions p WHERE
 (p.code='objects.hr_reports_view' AND u.login IN ('lazutina','kireeva')) OR
 (p.code='visit_plans.manage' AND u.login IN ('lebedev','gorbacheva')) OR
 (p.code='one_time_order.escorts.manage' AND u.login IN ('drozdovskiy','berendyakov')) OR
 (p.code='chat.room.manage_members' AND u.login IN ('stepanova','lebedev'))
ON CONFLICT ("userId", "permissionId") DO NOTHING;
COMMIT;
