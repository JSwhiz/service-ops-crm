import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { SEEDED_OBJECT_ID } from './helpers/core-fixtures';

function authHeaders(cookie: string): Record<string, string> {
  return { Cookie: cookie, 'Content-Type': 'application/json' };
}

test('erroneous assignment deletion is guarded, audited and concurrency-safe', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const hrCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'hr1',
    password: 'hr123',
  });
  const hr = await prisma.user.findUniqueOrThrow({
    where: { login: 'hr1' },
    select: { id: true },
  });

  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const createAssignment = async () => {
    const employee = await prisma.employee.create({
      data: {
        fullName: `Assignment delete ${randomUUID().slice(0, 8)}`,
        employmentStatus: 'active',
      },
    });
    const assignment = await prisma.objectEmployeeAssignment.create({
      data: {
        employeeId: employee.id,
        objectId: SEEDED_OBJECT_ID,
        isActive: true,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const history = await prisma.employeeObjectAssignmentHistory.create({
      data: {
        employeeId: employee.id,
        objectId: SEEDED_OBJECT_ID,
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdByUserId: hr.id,
      },
    });
    return { employee, assignment, history };
  };

  const clean = await createAssignment();
  const deleteResponse = await fetch(
    `${baseUrl}/api/v1/employees/${clean.employee.id}/object-assignment-history/${clean.history.id}/delete-as-error`,
    {
      method: 'POST',
      headers: authHeaders(hrCookie),
      body: JSON.stringify({ reason: 'Назначение создано ошибочно' }),
    },
  );
  assert.equal(deleteResponse.status, 201);
  assert.equal(
    await prisma.objectEmployeeAssignment.count({
      where: { id: clean.assignment.id },
    }),
    0,
  );
  assert.equal(
    await prisma.employeeObjectAssignmentHistory.count({
      where: { id: clean.history.id },
    }),
    0,
  );
  const deletionAudit = await prisma.auditEvent.findFirst({
    where: {
      entityType: 'employee',
      entityId: clean.employee.id,
      action: 'employee.object_assignment.deleted_as_error',
    },
  });
  assert.ok(deletionAudit);

  const used = await createAssignment();
  await prisma.objectAttendanceFact.create({
    data: {
      employeeId: used.employee.id,
      objectId: SEEDED_OBJECT_ID,
      operationDate: new Date('2026-01-02T00:00:00.000Z'),
      dailyRateSnapshot: 1000,
    },
  });
  const blockedResponse = await fetch(
    `${baseUrl}/api/v1/employees/${used.employee.id}/object-assignment-history/${used.history.id}/delete-as-error`,
    {
      method: 'POST',
      headers: authHeaders(hrCookie),
      body: JSON.stringify({ reason: 'Проверка блокировки истории' }),
    },
  );
  assert.equal(blockedResponse.status, 409);
  assert.equal(
    ((await blockedResponse.json()) as { code?: string }).code,
    'ASSIGNMENT_HAS_OPERATIONAL_HISTORY',
  );

  const concurrent = await createAssignment();
  const [endResponse, concurrentDeleteResponse] = await Promise.all([
    fetch(
      `${baseUrl}/api/v1/employees/${concurrent.employee.id}/object-assignments/${SEEDED_OBJECT_ID}`,
      { method: 'DELETE', headers: authHeaders(hrCookie) },
    ),
    fetch(
      `${baseUrl}/api/v1/employees/${concurrent.employee.id}/object-assignment-history/${concurrent.history.id}/delete-as-error`,
      {
        method: 'POST',
        headers: authHeaders(hrCookie),
        body: JSON.stringify({ reason: 'Параллельное исправление назначения' }),
      },
    ),
  ]);
  const raceStatuses = [endResponse.status, concurrentDeleteResponse.status];
  assert.ok(
    (raceStatuses[0] === 200 &&
      (raceStatuses[1] === 201 || raceStatuses[1] === 409)) ||
      (raceStatuses[0] === 409 && raceStatuses[1] === 201),
  );

  const [assignmentAfterRace, historyAfterRace] = await Promise.all([
    prisma.objectEmployeeAssignment.findUnique({
      where: { id: concurrent.assignment.id },
    }),
    prisma.employeeObjectAssignmentHistory.findUnique({
      where: { id: concurrent.history.id },
    }),
  ]);
  if (concurrentDeleteResponse.status === 201) {
    assert.equal(assignmentAfterRace, null);
    assert.equal(historyAfterRace, null);
  } else {
    assert.equal(endResponse.status, 200);
    assert.equal(assignmentAfterRace?.isActive, false);
    assert.ok(assignmentAfterRace?.endDate);
    assert.ok(historyAfterRace?.endedAt);
  }
});

test('erroneous assignment blockers are limited to the assignment period', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const hrCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'hr1',
    password: 'hr123',
  });
  const hr = await prisma.user.findUniqueOrThrow({
    where: { login: 'hr1' },
    select: { id: true },
  });
  const counterpart = await prisma.employee.create({
    data: { fullName: `Counterpart ${randomUUID()}`, employmentStatus: 'active' },
  });
  const startedAt = new Date('2025-01-10T00:00:00.000Z');
  const endedAt = new Date('2025-01-20T23:59:59.000Z');

  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const runCase = async (
    setup: (employeeId: string) => Promise<void>,
    expectedStatus: 201 | 409,
  ): Promise<void> => {
    const employee = await prisma.employee.create({
      data: {
        fullName: `Period guard ${randomUUID()}`,
        employmentStatus: 'active',
      },
    });
    await prisma.objectEmployeeAssignment.create({
      data: {
        employeeId: employee.id,
        objectId: SEEDED_OBJECT_ID,
        isActive: false,
        startDate: startedAt,
        endDate: endedAt,
      },
    });
    const history = await prisma.employeeObjectAssignmentHistory.create({
      data: {
        employeeId: employee.id,
        objectId: SEEDED_OBJECT_ID,
        startedAt,
        endedAt,
        createdByUserId: hr.id,
        closedByUserId: hr.id,
      },
    });
    await setup(employee.id);
    const response = await fetch(
      `${baseUrl}/api/v1/employees/${employee.id}/object-assignment-history/${history.id}/delete-as-error`,
      {
        method: 'POST',
        headers: authHeaders(hrCookie),
        body: JSON.stringify({ reason: 'Проверка периода назначения' }),
      },
    );
    assert.equal(response.status, expectedStatus);
  };

  const attendance = (operationDate: string) => (employeeId: string) =>
    prisma.objectAttendanceFact.create({
      data: {
        employeeId,
        objectId: SEEDED_OBJECT_ID,
        operationDate: new Date(operationDate),
        dailyRateSnapshot: 1000,
      },
    }).then(() => undefined);
  await runCase(attendance('2025-01-15T00:00:00.000Z'), 409);
  await runCase(attendance('2025-02-01T00:00:00.000Z'), 201);
  await runCase(attendance('2024-12-31T00:00:00.000Z'), 201);

  const timesheet = (year: number, month: number) => async (employeeId: string) => {
    const sheet = await prisma.timesheetMonth.upsert({
      where: { objectId_year_month: { objectId: SEEDED_OBJECT_ID, year, month } },
      update: {},
      create: { objectId: SEEDED_OBJECT_ID, year, month, createdByUserId: hr.id },
    });
    await prisma.timesheetEmployeeRow.create({
      data: {
        timesheetMonthId: sheet.id,
        employeeId,
        employeeNameSnapshot: 'Period test',
      },
    });
  };
  await runCase(timesheet(2025, 1), 409);
  await runCase(timesheet(2025, 2), 201);
  await runCase(timesheet(2026, 1), 201);

  const manualException = (year: number, month: number, dayOfMonth: number) =>
    (employeeId: string) => prisma.timesheetManualException.create({
      data: {
        objectId: SEEDED_OBJECT_ID,
        employeeId,
        year,
        month,
        dayOfMonth,
        requestedDayValue: 1000,
        currentDayValueSnapshot: 0,
        comment: 'Period test',
        requestedByUserId: hr.id,
      },
    }).then(() => undefined);
  await runCase(manualException(2025, 1, 15), 409);
  await runCase(manualException(2025, 2, 1), 201);

  const substitution = (startDate: string, endDate: string) =>
    (employeeId: string) => prisma.employeeSubstitution.create({
      data: {
        employeeId,
        substituteEmployeeId: counterpart.id,
        objectId: SEEDED_OBJECT_ID,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        status: 'planned',
        reason: 'Period test',
        createdByUserId: hr.id,
      },
    }).then(() => undefined);
  await runCase(
    substitution('2025-01-05T00:00:00.000Z', '2025-01-12T00:00:00.000Z'),
    409,
  );
  await runCase(
    substitution('2025-02-01T00:00:00.000Z', '2025-02-05T00:00:00.000Z'),
    201,
  );
});

test('erroneous history deletion removes only its matching canonical lifecycle', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const [hrCookie, founderCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'hr1', password: 'hr123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' }),
  ]);
  const hr = await prisma.user.findUniqueOrThrow({
    where: { login: 'hr1' },
    select: { id: true },
  });
  const objectCount = await prisma.object.count();

  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const deleteHistory = (employeeId: string, historyId: string) => fetch(
    `${baseUrl}/api/v1/employees/${employeeId}/object-assignment-history/${historyId}/delete-as-error`,
    {
      method: 'POST',
      headers: authHeaders(hrCookie),
      body: JSON.stringify({ reason: 'Ошибочное назначение' }),
    },
  );

  const removable = await prisma.employee.create({
    data: { fullName: `Orphan ${randomUUID()}`, employmentStatus: 'active' },
  });
  const oldStart = new Date('2025-01-01T00:00:00.000Z');
  const oldEnd = new Date('2025-01-31T00:00:00.000Z');
  const orphan = await prisma.objectEmployeeAssignment.create({
    data: {
      employeeId: removable.id,
      objectId: SEEDED_OBJECT_ID,
      isActive: false,
      startDate: oldStart,
      endDate: oldEnd,
    },
  });
  const removableHistory = await prisma.employeeObjectAssignmentHistory.create({
    data: {
      employeeId: removable.id,
      objectId: SEEDED_OBJECT_ID,
      startedAt: oldStart,
      endedAt: oldEnd,
      createdByUserId: hr.id,
      closedByUserId: hr.id,
    },
  });
  assert.equal((await deleteHistory(removable.id, removableHistory.id)).status, 201);
  assert.equal(await prisma.objectEmployeeAssignment.count({ where: { id: orphan.id } }), 0);
  const fresh = await prisma.employee.findUniqueOrThrow({ where: { id: removable.id } });
  const hardDelete = await fetch(
    `${baseUrl}/api/v1/employees/${removable.id}/delete-permanently`,
    {
      method: 'POST',
      headers: authHeaders(founderCookie),
      body: JSON.stringify({ expectedVersion: fresh.version, reason: 'Ошибочная пустая карточка' }),
    },
  );
  assert.equal(hardDelete.status, 201);

  for (const newerIsActive of [true, false]) {
    const employee = await prisma.employee.create({
      data: { fullName: `Reassigned ${randomUUID()}`, employmentStatus: 'active' },
    });
    const history = await prisma.employeeObjectAssignmentHistory.create({
      data: {
        employeeId: employee.id,
        objectId: SEEDED_OBJECT_ID,
        startedAt: oldStart,
        endedAt: oldEnd,
        createdByUserId: hr.id,
        closedByUserId: hr.id,
      },
    });
    const newerStart = new Date('2025-03-01T00:00:00.000Z');
    const newerEnd = newerIsActive ? null : new Date('2025-03-31T00:00:00.000Z');
    const canonical = await prisma.objectEmployeeAssignment.create({
      data: {
        employeeId: employee.id,
        objectId: SEEDED_OBJECT_ID,
        isActive: newerIsActive,
        startDate: newerStart,
        endDate: newerEnd,
      },
    });
    await prisma.employeeObjectAssignmentHistory.create({
      data: {
        employeeId: employee.id,
        objectId: SEEDED_OBJECT_ID,
        startedAt: newerStart,
        endedAt: newerEnd,
        createdByUserId: hr.id,
        ...(newerEnd ? { closedByUserId: hr.id } : {}),
      },
    });
    assert.equal((await deleteHistory(employee.id, history.id)).status, 201);
    assert.equal(await prisma.objectEmployeeAssignment.count({ where: { id: canonical.id } }), 1);
  }

  assert.equal(await prisma.object.count(), objectCount);
});

test('permanent employee deletion requires permission and an empty dependency graph', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const [founderCookie, hrCookie] = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: 'founder',
      password: 'founder123',
    }),
    loginAndGetCookieHeader({ baseUrl, login: 'hr1', password: 'hr123' }),
  ]);

  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const clean = await prisma.employee.create({
    data: {
      fullName: `Permanent delete ${randomUUID().slice(0, 8)}`,
      employmentStatus: 'active',
    },
  });
  const missingReason = await fetch(
    `${baseUrl}/api/v1/employees/${clean.id}/delete-permanently`,
    {
      method: 'POST',
      headers: authHeaders(founderCookie),
      body: JSON.stringify({ expectedVersion: clean.version, reason: '' }),
    },
  );
  assert.equal(missingReason.status, 400);

  const staleDelete = await fetch(
    `${baseUrl}/api/v1/employees/${clean.id}/delete-permanently`,
    {
      method: 'POST',
      headers: authHeaders(founderCookie),
      body: JSON.stringify({
        expectedVersion: clean.version + 1,
        reason: 'Устаревшая версия карточки',
      }),
    },
  );
  assert.equal(staleDelete.status, 409);
  assert.equal(
    ((await staleDelete.json()) as { code?: string }).code,
    'EMPLOYEE_VERSION_CONFLICT',
  );

  const denied = await fetch(
    `${baseUrl}/api/v1/employees/${clean.id}/delete-permanently`,
    {
      method: 'POST',
      headers: authHeaders(hrCookie),
      body: JSON.stringify({
        expectedVersion: clean.version,
        reason: 'Ошибочная карточка сотрудника',
      }),
    },
  );
  assert.equal(denied.status, 403);

  const deleted = await fetch(
    `${baseUrl}/api/v1/employees/${clean.id}/delete-permanently`,
    {
      method: 'POST',
      headers: authHeaders(founderCookie),
      body: JSON.stringify({
        expectedVersion: clean.version,
        reason: 'Ошибочная карточка сотрудника',
      }),
    },
  );
  assert.equal(deleted.status, 201);
  assert.equal(
    await prisma.employee.count({ where: { id: clean.id } }),
    0,
  );
  const deleteAudit = await prisma.auditEvent.findFirst({
      where: {
        entityType: 'employee',
        entityId: clean.id,
        action: 'employee.deleted_permanently',
      },
    });
  assert.ok(deleteAudit);
  assert.equal(
    (deleteAudit.oldValues as { fullName?: string } | null)?.fullName,
    clean.fullName,
  );
  assert.equal(
    (deleteAudit.metadata as { reason?: string } | null)?.reason,
    'Ошибочная карточка сотрудника',
  );

  const archived = await prisma.employee.create({
    data: {
      fullName: `Archived delete ${randomUUID().slice(0, 8)}`,
      employmentStatus: 'inactive',
      deletedAt: new Date(),
    },
  });
  const archivedDelete = await fetch(
    `${baseUrl}/api/v1/employees/${archived.id}/delete-permanently`,
    {
      method: 'POST',
      headers: authHeaders(founderCookie),
      body: JSON.stringify({
        expectedVersion: archived.version,
        reason: 'Ошибочная архивная карточка',
      }),
    },
  );
  assert.equal(archivedDelete.status, 201);

  const used = await prisma.employee.create({
    data: {
      fullName: `Protected delete ${randomUUID().slice(0, 8)}`,
      employmentStatus: 'active',
    },
  });
  await prisma.objectEmployeeAssignment.create({
    data: {
      employeeId: used.id,
      objectId: SEEDED_OBJECT_ID,
      isActive: false,
      endDate: new Date(),
    },
  });
  const blocked = await fetch(
    `${baseUrl}/api/v1/employees/${used.id}/delete-permanently`,
    {
      method: 'POST',
      headers: authHeaders(founderCookie),
      body: JSON.stringify({
        expectedVersion: used.version,
        reason: 'Проверка зависимостей карточки',
      }),
    },
  );
  assert.equal(blocked.status, 409);
  const blockedBody = (await blocked.json()) as {
    code?: string;
    blockers?: Array<{ code: string; count: number }>;
  };
  assert.equal(blockedBody.code, 'EMPLOYEE_HAS_OPERATIONAL_HISTORY');
  assert.ok(
    blockedBody.blockers?.some(
      (blocker) => blocker.code === 'object_assignments' && blocker.count === 1,
    ),
  );

  const rollbackEmployee = await prisma.employee.create({
    data: {
      fullName: `Audit rollback ${randomUUID().slice(0, 8)}`,
      employmentStatus: 'active',
    },
  });
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION fail_employee_delete_audit()
    RETURNS trigger AS $$
    BEGIN
      IF NEW."action" = 'employee.deleted_permanently' THEN
        RAISE EXCEPTION 'forced employee delete audit failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER fail_employee_delete_audit_trigger
    BEFORE INSERT ON "audit_events"
    FOR EACH ROW EXECUTE FUNCTION fail_employee_delete_audit()
  `);
  try {
    const failedDelete = await fetch(
      `${baseUrl}/api/v1/employees/${rollbackEmployee.id}/delete-permanently`,
      {
        method: 'POST',
        headers: authHeaders(founderCookie),
        body: JSON.stringify({
          expectedVersion: rollbackEmployee.version,
          reason: 'Проверка атомарности аудита',
        }),
      },
    );
    assert.equal(failedDelete.status, 500);
    assert.equal(
      await prisma.employee.count({ where: { id: rollbackEmployee.id } }),
      1,
    );
  } finally {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS fail_employee_delete_audit_trigger ON "audit_events"',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS fail_employee_delete_audit()',
    );
  }
});

test('permanent delete exposes every protected dependency and database constraints remain restrictive', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const founderCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'founder',
    password: 'founder123',
  });
  const founder = await prisma.user.findUniqueOrThrow({
    where: { login: 'founder' },
    select: { id: true },
  });

  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const employee = await prisma.employee.create({
    data: {
      fullName: `All dependencies ${randomUUID().slice(0, 8)}`,
      employmentStatus: 'active',
    },
  });
  const counterpart = await prisma.employee.create({
    data: {
      fullName: `Dependency counterpart ${randomUUID().slice(0, 8)}`,
      employmentStatus: 'active',
    },
  });
  await prisma.objectEmployeeAssignment.create({
    data: {
      employeeId: employee.id,
      objectId: SEEDED_OBJECT_ID,
      isActive: true,
    },
  });
  await prisma.employeeObjectAssignmentHistory.create({
    data: {
      employeeId: employee.id,
      objectId: SEEDED_OBJECT_ID,
      startedAt: new Date('2098-01-01T00:00:00.000Z'),
      createdByUserId: founder.id,
    },
  });
  await prisma.employeeAvailabilityWindow.create({
    data: {
      employeeId: employee.id,
      startDate: new Date('2098-01-01T00:00:00.000Z'),
      availabilityStatus: 'unavailable',
      createdByUserId: founder.id,
    },
  });
  await prisma.employeeSubstitution.createMany({
    data: [
      {
        employeeId: employee.id,
        substituteEmployeeId: counterpart.id,
        startDate: new Date('2098-01-02T00:00:00.000Z'),
        status: 'planned',
        reason: 'Primary dependency',
        createdByUserId: founder.id,
      },
      {
        employeeId: counterpart.id,
        substituteEmployeeId: employee.id,
        startDate: new Date('2098-01-03T00:00:00.000Z'),
        status: 'planned',
        reason: 'Replacement dependency',
        createdByUserId: founder.id,
      },
    ],
  });
  await prisma.objectAttendanceFact.create({
    data: {
      employeeId: employee.id,
      objectId: SEEDED_OBJECT_ID,
      operationDate: new Date('2098-01-04T00:00:00.000Z'),
      dailyRateSnapshot: 1000,
    },
  });
  const timesheetMonth = await prisma.timesheetMonth.create({
    data: {
      objectId: SEEDED_OBJECT_ID,
      year: 2098,
      month: 1,
      createdByUserId: founder.id,
    },
  });
  await prisma.timesheetEmployeeRow.create({
    data: {
      timesheetMonthId: timesheetMonth.id,
      employeeId: employee.id,
      employeeNameSnapshot: employee.fullName,
    },
  });
  await prisma.timesheetManualException.create({
    data: {
      objectId: SEEDED_OBJECT_ID,
      employeeId: employee.id,
      year: 2098,
      month: 1,
      dayOfMonth: 5,
      requestedDayValue: 1500,
      currentDayValueSnapshot: 1000,
      comment: 'Dependency guard',
      requestedByUserId: founder.id,
    },
  });

  await assert.rejects(prisma.employee.delete({ where: { id: employee.id } }));

  const response = await fetch(
    `${baseUrl}/api/v1/employees/${employee.id}/delete-permanently`,
    {
      method: 'POST',
      headers: authHeaders(founderCookie),
      body: JSON.stringify({
        expectedVersion: employee.version,
        reason: 'Проверка полного dependency graph',
      }),
    },
  );
  assert.equal(response.status, 409);
  const body = (await response.json()) as {
    blockers?: Array<{ code: string; count: number }>;
  };
  assert.deepEqual(
    new Set(body.blockers?.map((blocker) => blocker.code)),
    new Set([
      'object_assignments',
      'assignment_history',
      'availability_windows',
      'substitutions_primary',
      'substitutions_replacement',
      'attendance_facts',
      'timesheet_rows',
      'timesheet_exceptions',
    ]),
  );
});
