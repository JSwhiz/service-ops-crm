-- Employee profile fields are independent from employment/archive state.
ALTER TABLE "employees"
ADD COLUMN "employeeType" TEXT NOT NULL DEFAULT 'regular',
ADD COLUMN "workScheduleCode" TEXT,
ADD COLUMN "workScheduleCustom" TEXT,
ADD COLUMN "workTimeText" TEXT;

CREATE INDEX "employees_employeeType_idx" ON "employees"("employeeType");
CREATE INDEX "employees_workScheduleCode_idx" ON "employees"("workScheduleCode");

-- Operational Employee history must block accidental hard deletion.
ALTER TABLE "object_employee_assignments"
DROP CONSTRAINT "object_employee_assignments_employeeId_fkey",
ADD CONSTRAINT "object_employee_assignments_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_object_assignment_history"
DROP CONSTRAINT "employee_object_assignment_history_employeeId_fkey",
ADD CONSTRAINT "employee_object_assignment_history_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_availability_windows"
DROP CONSTRAINT "employee_availability_windows_employeeId_fkey",
ADD CONSTRAINT "employee_availability_windows_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_substitutions"
DROP CONSTRAINT "employee_substitutions_employeeId_fkey",
ADD CONSTRAINT "employee_substitutions_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_substitutions"
DROP CONSTRAINT "employee_substitutions_substituteEmployeeId_fkey",
ADD CONSTRAINT "employee_substitutions_substituteEmployeeId_fkey"
  FOREIGN KEY ("substituteEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "object_attendance_facts"
DROP CONSTRAINT "object_attendance_facts_employeeId_fkey",
ADD CONSTRAINT "object_attendance_facts_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Canonical roles and employee permissions must not depend on development seed.
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
  (gen_random_uuid()::TEXT, 'employees.view', 'Просмотр сотрудников', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'employees.create', 'Создание сотрудников', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'employees.edit', 'Редактирование сотрудников', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'employees.archive', 'Архивация сотрудников', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'employees.restore', 'Восстановление сотрудников', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'employees.delete_permanently', 'Полное удаление ошибочных карточек сотрудников', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'employees.assignments.manage', 'Управление назначениями сотрудников', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'employees.assignments.delete_error', 'Удаление ошибочных назначений сотрудников', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::TEXT, 'objects.view_hr', 'HR-просмотр объектов', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "role_permissions" ("id", "roleId", "permissionId", "createdAt")
SELECT gen_random_uuid()::TEXT, role_record."id", permission_record."id", CURRENT_TIMESTAMP
FROM (
  VALUES
    ('founder', 'employees.view'), ('deputy_founder', 'employees.view'),
    ('director', 'employees.view'), ('corporate_director', 'employees.view'),
    ('deputy_director', 'employees.view'), ('hr', 'employees.view'),
    ('operation_manager', 'employees.view'), ('manager', 'employees.view'),
    ('founder', 'employees.create'), ('deputy_founder', 'employees.create'),
    ('director', 'employees.create'), ('corporate_director', 'employees.create'),
    ('deputy_director', 'employees.create'), ('hr', 'employees.create'),
    ('founder', 'employees.edit'), ('deputy_founder', 'employees.edit'),
    ('director', 'employees.edit'), ('corporate_director', 'employees.edit'),
    ('deputy_director', 'employees.edit'), ('hr', 'employees.edit'),
    ('founder', 'employees.archive'), ('deputy_founder', 'employees.archive'),
    ('director', 'employees.archive'), ('corporate_director', 'employees.archive'),
    ('deputy_director', 'employees.archive'), ('hr', 'employees.archive'),
    ('founder', 'employees.restore'), ('deputy_founder', 'employees.restore'),
    ('director', 'employees.restore'), ('corporate_director', 'employees.restore'),
    ('deputy_director', 'employees.restore'), ('hr', 'employees.restore'),
    ('founder', 'employees.assignments.manage'), ('deputy_founder', 'employees.assignments.manage'),
    ('director', 'employees.assignments.manage'), ('corporate_director', 'employees.assignments.manage'),
    ('deputy_director', 'employees.assignments.manage'), ('hr', 'employees.assignments.manage'),
    ('founder', 'employees.assignments.delete_error'), ('deputy_founder', 'employees.assignments.delete_error'),
    ('director', 'employees.assignments.delete_error'), ('deputy_director', 'employees.assignments.delete_error'),
    ('hr', 'employees.assignments.delete_error'),
    ('founder', 'employees.delete_permanently'), ('deputy_founder', 'employees.delete_permanently'),
    ('director', 'employees.delete_permanently'), ('deputy_director', 'employees.delete_permanently'),
    ('hr', 'objects.view_hr')
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
        ('founder', 'employees.view'), ('deputy_founder', 'employees.view'),
        ('director', 'employees.view'), ('corporate_director', 'employees.view'),
        ('deputy_director', 'employees.view'), ('hr', 'employees.view'),
        ('operation_manager', 'employees.view'), ('manager', 'employees.view'),
        ('deputy_director', 'employees.create'), ('deputy_director', 'employees.edit'),
        ('deputy_director', 'employees.archive'), ('deputy_director', 'employees.restore'),
        ('deputy_director', 'employees.assignments.manage'),
        ('deputy_director', 'employees.assignments.delete_error'),
        ('deputy_director', 'employees.delete_permanently'),
        ('hr', 'objects.view_hr')
    ) AS expected("roleCode", "permissionCode")
    LEFT JOIN "roles" role_record ON role_record."code" = expected."roleCode"
    LEFT JOIN "permissions" permission_record ON permission_record."code" = expected."permissionCode"
    LEFT JOIN "role_permissions" binding
      ON binding."roleId" = role_record."id"
      AND binding."permissionId" = permission_record."id"
    WHERE binding."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Canonical employee role permissions were not installed';
  END IF;
END $$;
