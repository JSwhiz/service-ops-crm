import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import {
  cleanupCoreTestObject,
  createCoreTestObject,
  SEEDED_OBJECT_ID,
} from './helpers/core-fixtures';

test('HR object access is read-only except employee staffing', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const hrCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'hr1',
    password: 'hr123',
  });
  const headers = { Cookie: hrCookie, 'Content-Type': 'application/json' };

  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const listResponse = await fetch(`${baseUrl}/api/v1/objects?q=`, {
    headers,
  });
  assert.equal(listResponse.status, 200);
  const list = (await listResponse.json()) as {
    items: Array<{
      id: string;
      dailyRate: number;
      employees: Array<{ baseDailyRate: number | null }>;
      capabilities: {
        canEdit: boolean;
        canViewBasicProfile: boolean;
        canViewOperationalSections: boolean;
        canManageEmployees: boolean;
      };
    }>;
  };
  const listedObject = list.items.find((item) => item.id === SEEDED_OBJECT_ID);
  assert.ok(listedObject);
  assert.equal(typeof listedObject.dailyRate, 'number');
  assert.ok(Array.isArray(listedObject.employees));
  assert.equal(listedObject.capabilities.canEdit, false);
  assert.equal(listedObject.capabilities.canViewBasicProfile, true);
  assert.equal(listedObject.capabilities.canViewOperationalSections, false);
  assert.equal(listedObject.capabilities.canManageEmployees, true);

  const cardResponse = await fetch(
    `${baseUrl}/api/v1/objects/${SEEDED_OBJECT_ID}`,
    { headers },
  );
  assert.equal(cardResponse.status, 200);

  const createResponse = await fetch(`${baseUrl}/api/v1/objects`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'HR cannot create',
      internalName: 'HR denied',
      address: 'Москва, тестовый адрес',
      status: 'active',
      dailyRate: 1000,
      responsibleUserId: randomUUID(),
    }),
  });
  assert.equal(createResponse.status, 403);

  const [
    commentsResponse,
    auditResponse,
    reportResponse,
    inventoryResponse,
    equipmentResponse,
    updateResponse,
  ] = await Promise.all([
    fetch(`${baseUrl}/api/v1/objects/${SEEDED_OBJECT_ID}/comments`, {
      headers,
    }),
    fetch(`${baseUrl}/api/v1/objects/${SEEDED_OBJECT_ID}/audit`, { headers }),
    fetch(`${baseUrl}/api/v1/objects/${SEEDED_OBJECT_ID}/daily-report/today`, {
      headers,
    }),
    fetch(`${baseUrl}/api/v1/inventory/items`, { headers }),
    fetch(`${baseUrl}/api/v1/equipment/catalog`, { headers }),
    fetch(`${baseUrl}/api/v1/objects/${SEEDED_OBJECT_ID}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'HR cannot edit' }),
    }),
  ]);
  assert.equal(commentsResponse.status, 403);
  assert.equal(auditResponse.status, 404);
  assert.equal(reportResponse.status, 403);
  assert.equal(inventoryResponse.status, 403);
  assert.equal(equipmentResponse.status, 403);
  assert.equal(updateResponse.status, 403);

  const employee = await prisma.employee.create({
    data: {
      fullName: `HR staffing ${randomUUID().slice(0, 8)}`,
      position: 'Клинер',
      baseDailyRate: 1700,
      workScheduleCode: '5_2',
      workTimeText: '08:00–17:00',
      employmentStatus: 'active',
    },
  });
  const directoryResponse = await fetch(
    `${baseUrl}/api/v1/objects/${SEEDED_OBJECT_ID}/employee-directory?search=${encodeURIComponent(employee.fullName)}`,
    { headers },
  );
  assert.equal(directoryResponse.status, 200);
  const directory = (await directoryResponse.json()) as Array<{
    id: string;
    position: string | null;
    baseDailyRate: number | null;
    workScheduleCode: string | null;
    workTimeText: string | null;
  }>;
  assert.equal(directory[0]?.id, employee.id);
  assert.equal(directory[0]?.position, 'Клинер');
  assert.equal(directory[0]?.baseDailyRate, 1700);
  assert.equal(directory[0]?.workScheduleCode, '5_2');
  assert.equal(directory[0]?.workTimeText, '08:00–17:00');

  const addResponse = await fetch(
    `${baseUrl}/api/v1/objects/${SEEDED_OBJECT_ID}/employees`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ employeeId: employee.id }),
    },
  );
  assert.equal(addResponse.status, 201);
  const assignedResponse = await fetch(
    `${baseUrl}/api/v1/objects/${SEEDED_OBJECT_ID}/employees`,
    { headers },
  );
  assert.equal(assignedResponse.status, 200);
  const assigned = (await assignedResponse.json()) as Array<{ id: string }>;
  assert.ok(assigned.some((item) => item.id === employee.id));

  const removeResponse = await fetch(
    `${baseUrl}/api/v1/objects/${SEEDED_OBJECT_ID}/employees/${employee.id}`,
    { method: 'DELETE', headers },
  );
  assert.equal(removeResponse.status, 200);
});

test('direct objects.view_hr permission grants only basic object visibility', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const managerCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'manager1',
    password: 'manager123',
  });
  const manager = await prisma.user.findUniqueOrThrow({
    where: { login: 'manager1' },
    select: { id: true },
  });
  const permission = await prisma.permission.findUniqueOrThrow({
    where: { code: 'objects.view_hr' },
    select: { id: true },
  });
  const { objectId } = await createCoreTestObject(prisma);

  t.after(async () => {
    await cleanupCoreTestObject(prisma, objectId);
    await app.close();
    await prisma.$disconnect();
  });

  const before = await fetch(`${baseUrl}/api/v1/objects/${objectId}`, {
    headers: { Cookie: managerCookie },
  });
  assert.equal(before.status, 404);

  await prisma.userPermission.create({
    data: { userId: manager.id, permissionId: permission.id },
  });
  const basic = await fetch(`${baseUrl}/api/v1/objects/${objectId}`, {
    headers: { Cookie: managerCookie },
  });
  assert.equal(basic.status, 200);
  const body = (await basic.json()) as {
    capabilities: {
      canViewBasicProfile: boolean;
      canViewOperationalSections: boolean;
    };
  };
  assert.equal(body.capabilities.canViewBasicProfile, true);
  assert.equal(body.capabilities.canViewOperationalSections, false);

  const report = await fetch(
    `${baseUrl}/api/v1/objects/${objectId}/daily-report/today`,
    { headers: { Cookie: managerCookie } },
  );
  assert.equal(report.status, 403);
});
