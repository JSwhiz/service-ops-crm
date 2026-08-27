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
  assert.deepEqual(
    [endResponse.status, concurrentDeleteResponse.status].sort((a, b) => a - b),
    [200, 409],
  );
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
  assert.ok(
    await prisma.auditEvent.findFirst({
      where: {
        entityType: 'employee',
        entityId: clean.id,
        action: 'employee.deleted_permanently',
      },
    }),
  );

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
});
