import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { SEEDED_OBJECT_ID } from './helpers/core-fixtures';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('hr can create employee card and manage shared employee domain actions', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const hrCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'hr1',
    password: 'hr123',
  });

  let createdEmployeeId: string | null = null;

  t.after(async () => {
    if (createdEmployeeId) {
      await prisma.employee.deleteMany({
        where: {
          id: createdEmployeeId,
        },
      });
    }

    await app.close();
    await prisma.$disconnect();
  });

  const createResponse = await fetch(`${baseUrl}/api/v1/employees`, {
    method: 'POST',
    headers: {
      Cookie: hrCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fullName: `Интеграционный сотрудник ${Date.now()}`,
      phone: '+79995550101',
      residenceAddress: 'Москва, Тестовая улица, 7',
      shiftPreferences: 'Будни, дневные смены',
      baseDailyRate: 1900,
      notes: 'Создан в integration test',
      employmentStatus: 'active',
    }),
  });

  assert.equal(createResponse.status, 201);

  const createdEmployee = (await createResponse.json()) as {
    id: string;
    capabilities: {
      canEdit: boolean;
      canManageAssignments: boolean;
    };
  };

  createdEmployeeId = createdEmployee.id;
  assert.equal(createdEmployee.capabilities.canEdit, true);
  assert.equal(createdEmployee.capabilities.canManageAssignments, true);

  const statusResponse = await fetch(
    `${baseUrl}/api/v1/employees/${createdEmployeeId}/status`,
    {
      method: 'PATCH',
      headers: {
        Cookie: hrCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        employmentStatus: 'inactive',
      }),
    },
  );

  assert.equal(statusResponse.status, 200);

  const inactiveEmployee = (await statusResponse.json()) as {
    employmentStatus: string;
  };

  assert.equal(inactiveEmployee.employmentStatus, 'inactive');

  const reactivateResponse = await fetch(
    `${baseUrl}/api/v1/employees/${createdEmployeeId}/status`,
    {
      method: 'PATCH',
      headers: {
        Cookie: hrCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        employmentStatus: 'active',
      }),
    },
  );

  assert.equal(reactivateResponse.status, 200);

  const assignResponse = await fetch(
    `${baseUrl}/api/v1/employees/${createdEmployeeId}/object-assignments`,
    {
      method: 'POST',
      headers: {
        Cookie: hrCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        objectId: SEEDED_OBJECT_ID,
      }),
    },
  );

  assert.equal(assignResponse.status, 201);

  const assignedEmployee = (await assignResponse.json()) as {
    currentObjectAssignments: Array<{ objectId: string }>;
    objectAssignmentHistory: Array<{ objectId: string }>;
  };

  assert.ok(
    assignedEmployee.currentObjectAssignments.some(
      (assignment) => assignment.objectId === SEEDED_OBJECT_ID,
    ),
  );
  assert.ok(
    assignedEmployee.objectAssignmentHistory.some(
      (assignment) => assignment.objectId === SEEDED_OBJECT_ID,
    ),
  );

  const availabilityResponse = await fetch(
    `${baseUrl}/api/v1/employees/${createdEmployeeId}/availability`,
    {
      method: 'POST',
      headers: {
        Cookie: hrCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate: '2026-04-20',
        endDate: '2026-04-22',
        availabilityMode: 'full_day',
        availabilityStatus: 'unavailable',
        comment: 'Тестовый отпуск',
      }),
    },
  );

  assert.equal(availabilityResponse.status, 201);

  const substitutionTarget = await prisma.employee.findFirstOrThrow({
    where: {
      deletedAt: null,
      employmentStatus: 'active',
      id: {
        not: createdEmployeeId,
      },
    },
    select: {
      id: true,
    },
  });

  const substitutionResponse = await fetch(
    `${baseUrl}/api/v1/employees/${createdEmployeeId}/substitutions`,
    {
      method: 'POST',
      headers: {
        Cookie: hrCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        substituteEmployeeId: substitutionTarget.id,
        objectId: SEEDED_OBJECT_ID,
        startDate: '2026-04-21',
        endDate: '2026-04-23',
        status: 'planned',
        reason: 'Плановая подмена',
        comment: 'HR integration scenario',
      }),
    },
  );

  assert.equal(substitutionResponse.status, 201);

  const employeeDetailResponse = await fetch(
    `${baseUrl}/api/v1/employees/${createdEmployeeId}`,
    {
      headers: {
        Cookie: hrCookie,
      },
    },
  );

  assert.equal(employeeDetailResponse.status, 200);

  const employeeDetail = (await employeeDetailResponse.json()) as {
    currentObjectAssignments: Array<{ canOpenObjectCard: boolean }>;
    objectAssignmentHistory: Array<{ canOpenObjectCard: boolean }>;
    availabilityWindows: Array<{ comment: string | null; availabilityMode: string }>;
    substitutions: Array<{ reason: string }>;
  };

  assert.ok(
    employeeDetail.currentObjectAssignments.every(
      (assignment) => assignment.canOpenObjectCard === false,
    ),
  );
  assert.ok(
    employeeDetail.objectAssignmentHistory.every(
      (assignment) => assignment.canOpenObjectCard === false,
    ),
  );

  assert.ok(
    employeeDetail.availabilityWindows.some(
      (windowItem) =>
        windowItem.comment === 'Тестовый отпуск' &&
        windowItem.availabilityMode === 'full_day',
    ),
  );
  assert.ok(
    employeeDetail.substitutions.some(
      (substitution) => substitution.reason === 'Плановая подмена',
    ),
  );
});

test('manager cannot access employees registry', async (t) => {
  const { app, baseUrl } = await createTestApp();
  const managerCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'manager1',
    password: 'manager123',
  });

  t.after(async () => {
    await app.close();
  });

  const response = await fetch(`${baseUrl}/api/v1/employees`, {
    headers: {
      Cookie: managerCookie,
    },
  });

  assert.equal(response.status, 403);
});
