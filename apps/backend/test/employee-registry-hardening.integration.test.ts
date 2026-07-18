import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { SEEDED_EMPLOYEE_IDS, SEEDED_OBJECT_ID } from './helpers/core-fixtures';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

type EmployeeListResponse = {
  items: Array<{
    id: string;
    fullName: string;
    phone: string | null;
    position: string | null;
    birthDate: string | null;
    isArchived: boolean;
    currentObjectCount: number;
  }>;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

function authHeaders(cookie: string): Record<string, string> {
  return {
    Cookie: cookie,
    'Content-Type': 'application/json',
  };
}

test('employee create, validation and optimistic update are production-safe', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const hrCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'hr1',
    password: 'hr123',
  });

  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const migratedEmployee = await prisma.employee.findUniqueOrThrow({
    where: { id: SEEDED_EMPLOYEE_IDS.ivan },
    select: { birthDate: true, position: true, version: true },
  });
  assert.deepEqual(migratedEmployee, {
    birthDate: null,
    position: null,
    version: 1,
  });

  const marker = randomUUID().slice(0, 8);
  const createResponse = await fetch(`${baseUrl}/api/v1/employees`, {
    method: 'POST',
    headers: authHeaders(hrCookie),
    body: JSON.stringify({
      fullName: `  Тестовый сотрудник ${marker}  `,
      phone: '  +79990001122  ',
      position: '  Старший сотрудник  ',
      birthDate: '1992-03-12',
      residenceAddress: '  Москва  ',
      shiftPreferences: '  Дневные смены  ',
      baseDailyRate: 2500,
      notes: '  Проверка реестра  ',
      employmentStatus: 'active',
    }),
  });
  assert.equal(createResponse.status, 201);

  const created = (await createResponse.json()) as {
    id: string;
    fullName: string;
    phone: string | null;
    position: string | null;
    birthDate: string | null;
    version: number;
  };
  assert.equal(created.fullName, `Тестовый сотрудник ${marker}`);
  assert.equal(created.phone, '+79990001122');
  assert.equal(created.position, 'Старший сотрудник');
  assert.equal(created.birthDate, '1992-03-12');
  assert.equal(created.version, 1);

  const futureBirthDateResponse = await fetch(`${baseUrl}/api/v1/employees`, {
    method: 'POST',
    headers: authHeaders(hrCookie),
    body: JSON.stringify({
      fullName: 'Будущий сотрудник',
      birthDate: '2999-01-01',
    }),
  });
  assert.equal(futureBirthDateResponse.status, 400);

  const invalidTrimResponse = await fetch(`${baseUrl}/api/v1/employees`, {
    method: 'POST',
    headers: authHeaders(hrCookie),
    body: JSON.stringify({ fullName: '   ' }),
  });
  assert.equal(invalidTrimResponse.status, 400);

  const updateResponse = await fetch(`${baseUrl}/api/v1/employees/${created.id}`, {
    method: 'PATCH',
    headers: authHeaders(hrCookie),
    body: JSON.stringify({
      expectedVersion: created.version,
      position: 'Руководитель смены',
      phone: '',
      employmentStatus: 'inactive',
    }),
  });
  assert.equal(updateResponse.status, 200);
  const updated = (await updateResponse.json()) as {
    phone: string | null;
    position: string | null;
    employmentStatus: string;
    version: number;
  };
  assert.equal(updated.phone, null);
  assert.equal(updated.position, 'Руководитель смены');
  assert.equal(updated.employmentStatus, 'inactive');
  assert.equal(updated.version, 2);

  const conflictResponse = await fetch(`${baseUrl}/api/v1/employees/${created.id}`, {
    method: 'PATCH',
    headers: authHeaders(hrCookie),
    body: JSON.stringify({
      expectedVersion: created.version,
      position: 'Устаревшее изменение',
    }),
  });
  assert.equal(conflictResponse.status, 409);
  assert.equal(
    ((await conflictResponse.json()) as { code?: string }).code,
    'EMPLOYEE_VERSION_CONFLICT',
  );

  const auditActions = (
    await prisma.auditEvent.findMany({
      where: { entityType: 'employee', entityId: created.id },
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    })
  ).map((event) => event.action);
  assert.deepEqual(auditActions, ['employee.created', 'employee.updated']);
});

test('employee registry filters, pagination and active assignment semantics are consistent', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const hrCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'hr1',
    password: 'hr123',
  });

  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const marker = `Registry-${randomUUID().slice(0, 8)}`;
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()].sort() as [
    string,
    string,
    string,
    string,
  ];
  await prisma.employee.createMany({
    data: [
      {
        id: ids[0],
        fullName: `${marker} Одинаковое имя`,
        phone: '+70000000001',
        position: 'Клинер',
        birthDate: new Date('1990-03-10T00:00:00.000Z'),
        employmentStatus: 'active',
      },
      {
        id: ids[1],
        fullName: `${marker} Одинаковое имя`,
        phone: '+70000000002',
        position: 'Менеджер',
        birthDate: new Date('1985-04-11T00:00:00.000Z'),
        employmentStatus: 'active',
      },
      {
        id: ids[2],
        fullName: `${marker} Архив`,
        phone: '+70000000003',
        position: 'Клинер',
        birthDate: new Date('1995-03-12T00:00:00.000Z'),
        employmentStatus: 'inactive',
        deletedAt: new Date(),
      },
      {
        id: ids[3],
        fullName: `${marker} История`,
        phone: '+70000000004',
        position: null,
        birthDate: null,
        employmentStatus: 'active',
      },
    ],
  });
  await prisma.objectEmployeeAssignment.createMany({
    data: [
      {
        objectId: SEEDED_OBJECT_ID,
        employeeId: ids[0],
        isActive: true,
      },
      {
        objectId: SEEDED_OBJECT_ID,
        employeeId: ids[3],
        isActive: false,
        endDate: new Date(),
      },
    ],
  });

  const list = async (query: string): Promise<EmployeeListResponse> => {
    const response = await fetch(`${baseUrl}/api/v1/employees?${query}`, {
      headers: { Cookie: hrCookie },
    });
    assert.equal(response.status, 200);
    return (await response.json()) as EmployeeListResponse;
  };

  const active = await list(`search=${encodeURIComponent(marker)}`);
  assert.equal(active.total, 3);
  assert.ok(active.items.every((item) => !item.isArchived));

  const all = await list(
    `search=${encodeURIComponent(marker)}&archiveState=all&page=1&limit=2&sortBy=fullName&sortOrder=asc`,
  );
  assert.equal(all.total, 4);
  assert.equal(all.items.length, 2);
  assert.equal(all.page, 1);
  assert.equal(all.limit, 2);
  assert.equal(all.totalPages, 2);

  const sameName = await list(
    `search=${encodeURIComponent(`${marker} Одинаковое имя`)}&archiveState=all&sortBy=fullName`,
  );
  assert.deepEqual(
    sameName.items.map((item) => item.id),
    [ids[0], ids[1]],
  );

  assert.equal((await list('search=%2B70000000002&archiveState=all')).total, 1);
  assert.equal(
    (await list(`search=${encodeURIComponent(marker)}&position=${encodeURIComponent('Клинер')}&archiveState=all`)).total,
    2,
  );
  assert.equal(
    (await list(`search=${encodeURIComponent(marker)}&employmentStatus=inactive&archiveState=all`)).total,
    1,
  );
  assert.equal(
    (await list(`search=${encodeURIComponent(marker)}&archiveState=archived`)).total,
    1,
  );
  assert.equal(
    (await list(`search=${encodeURIComponent(marker)}&archiveState=all&birthMonth=3`)).total,
    2,
  );

  const byObject = await list(
    `search=${encodeURIComponent(marker)}&objectId=${SEEDED_OBJECT_ID}&archiveState=all`,
  );
  assert.deepEqual(byObject.items.map((item) => item.id), [ids[0]]);
  assert.equal(byObject.items[0]?.currentObjectCount, 1);

  const assigned = await list(
    `search=${encodeURIComponent(marker)}&hasActiveObjectAssignment=true&archiveState=all`,
  );
  assert.deepEqual(assigned.items.map((item) => item.id), [ids[0]]);
  const unassigned = await list(
    `search=${encodeURIComponent(marker)}&hasActiveObjectAssignment=false&archiveState=all`,
  );
  assert.deepEqual(
    unassigned.items.map((item) => item.id).sort(),
    [ids[1], ids[2], ids[3]].sort(),
  );
});

test('employee archive and restore preserve history, block active assignments and roll back with audit', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const [hrCookie, managerCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'hr1', password: 'hr123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
  ]);

  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const hrUser = await prisma.user.findUniqueOrThrow({
    where: { login: 'hr1' },
    select: { id: true },
  });
  const employee = await prisma.employee.create({
    data: {
      fullName: `Archive ${randomUUID().slice(0, 8)}`,
      employmentStatus: 'active',
    },
  });
  const blockedEmployee = await prisma.employee.create({
    data: {
      fullName: `Blocked ${randomUUID().slice(0, 8)}`,
      employmentStatus: 'active',
    },
  });
  const historyStartedAt = new Date('2025-01-01T00:00:00.000Z');
  const historyEndedAt = new Date('2025-02-01T00:00:00.000Z');
  await prisma.employeeObjectAssignmentHistory.create({
    data: {
      employeeId: employee.id,
      objectId: SEEDED_OBJECT_ID,
      startedAt: historyStartedAt,
      endedAt: historyEndedAt,
      createdByUserId: hrUser.id,
      closedByUserId: hrUser.id,
    },
  });
  await prisma.objectEmployeeAssignment.create({
    data: {
      objectId: SEEDED_OBJECT_ID,
      employeeId: blockedEmployee.id,
      isActive: true,
    },
  });

  const blockedResponse = await fetch(
    `${baseUrl}/api/v1/employees/${blockedEmployee.id}/archive`,
    {
      method: 'POST',
      headers: authHeaders(hrCookie),
      body: JSON.stringify({ expectedVersion: blockedEmployee.version }),
    },
  );
  assert.equal(blockedResponse.status, 409);
  assert.equal(
    ((await blockedResponse.json()) as { code?: string }).code,
    'EMPLOYEE_HAS_ACTIVE_OBJECT_ASSIGNMENTS',
  );

  const deniedArchive = await fetch(
    `${baseUrl}/api/v1/employees/${employee.id}/archive`,
    {
      method: 'POST',
      headers: authHeaders(managerCookie),
      body: JSON.stringify({ expectedVersion: employee.version }),
    },
  );
  assert.equal(deniedArchive.status, 403);

  const archiveResponse = await fetch(
    `${baseUrl}/api/v1/employees/${employee.id}/archive`,
    {
      method: 'POST',
      headers: authHeaders(hrCookie),
      body: JSON.stringify({ expectedVersion: employee.version }),
    },
  );
  assert.equal(archiveResponse.status, 201);
  const archived = (await archiveResponse.json()) as {
    version: number;
    isArchived: boolean;
    objectAssignmentHistory: Array<{ objectId: string }>;
    capabilities: { canEdit: boolean; canRestore: boolean };
  };
  assert.equal(archived.isArchived, true);
  assert.equal(archived.capabilities.canEdit, false);
  assert.equal(archived.capabilities.canRestore, true);
  assert.ok(
    archived.objectAssignmentHistory.some((item) => item.objectId === SEEDED_OBJECT_ID),
  );

  const restoreResponse = await fetch(
    `${baseUrl}/api/v1/employees/${employee.id}/restore`,
    {
      method: 'POST',
      headers: authHeaders(hrCookie),
      body: JSON.stringify({ expectedVersion: archived.version }),
    },
  );
  assert.equal(restoreResponse.status, 201);
  const restored = (await restoreResponse.json()) as {
    version: number;
    isArchived: boolean;
  };
  assert.equal(restored.isArchived, false);

  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION fail_employee_update_audit()
    RETURNS trigger AS $$
    BEGIN
      IF NEW."action" = 'employee.updated' THEN
        RAISE EXCEPTION 'forced employee audit failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER fail_employee_update_audit_trigger
    BEFORE INSERT ON "audit_events"
    FOR EACH ROW EXECUTE FUNCTION fail_employee_update_audit()
  `);

  try {
    const failedUpdate = await fetch(`${baseUrl}/api/v1/employees/${employee.id}`, {
      method: 'PATCH',
      headers: authHeaders(hrCookie),
      body: JSON.stringify({
        expectedVersion: restored.version,
        position: 'Не должно сохраниться',
      }),
    });
    assert.equal(failedUpdate.status, 500);
    const afterFailure = await prisma.employee.findUniqueOrThrow({
      where: { id: employee.id },
      select: { position: true, version: true },
    });
    assert.equal(afterFailure.position, null);
    assert.equal(afterFailure.version, restored.version);
  } finally {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER fail_employee_update_audit_trigger ON "audit_events"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION fail_employee_update_audit()');
  }

  const auditActions = (
    await prisma.auditEvent.findMany({
      where: { entityType: 'employee', entityId: employee.id },
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    })
  ).map((event) => event.action);
  assert.deepEqual(auditActions, ['employee.archived', 'employee.restored']);
});
