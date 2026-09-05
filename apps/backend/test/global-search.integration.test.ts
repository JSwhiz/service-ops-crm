import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/modules/auth/utils/password-hash.util';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('global search and recent resolution preserve domain ACL boundaries', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = randomUUID().slice(0, 8);
  const searchTerm = `wave13-${marker}`;
  const password = 'global-search-123';

  const [managerRole, hrRole, founderRole] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { code: 'manager' } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'hr' } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'founder' } }),
  ]);

  const passwordHash = await hashPassword(password);
  const [manager, hr, creator] = await Promise.all([
    prisma.user.create({
      data: {
        login: `search_manager_${marker}`,
        fullName: `Search Manager ${marker}`,
        passwordHash,
        isActive: true,
        roles: { create: [{ roleId: managerRole.id }] },
      },
    }),
    prisma.user.create({
      data: {
        login: `search_hr_${marker}`,
        fullName: `Search HR ${marker}`,
        passwordHash,
        isActive: true,
        roles: { create: [{ roleId: hrRole.id }] },
      },
    }),
    prisma.user.create({
      data: {
        login: `search_creator_${marker}`,
        fullName: `Search Creator ${marker}`,
        passwordHash,
        isActive: true,
        roles: { create: [{ roleId: founderRole.id }] },
      },
    }),
  ]);

  const [assignedObject, foreignObject] = await Promise.all([
    prisma.object.create({
      data: {
        name: `${searchTerm} assigned object`,
        address: `Assigned ${searchTerm}`,
        status: 'active',
        createdByUserId: creator.id,
      },
    }),
    prisma.object.create({
      data: {
        name: `${searchTerm} foreign object`,
        address: `Foreign ${searchTerm}`,
        status: 'active',
        createdByUserId: creator.id,
      },
    }),
  ]);

  await prisma.objectAssignment.create({
    data: {
      objectId: assignedObject.id,
      userId: manager.id,
      assignmentRoleCode: 'manager',
      isActive: true,
    },
  });

  const [assignedOrder, foreignOrder] = await Promise.all([
    prisma.oneTimeOrder.create({
      data: {
        title: `${searchTerm} assigned order`,
        executionAddress: `Assigned order ${searchTerm}`,
        status: 'planned',
        contactName: 'Assigned Contact',
        createdByUserId: creator.id,
      },
    }),
    prisma.oneTimeOrder.create({
      data: {
        title: `${searchTerm} foreign order`,
        executionAddress: `Foreign order ${searchTerm}`,
        status: 'planned',
        contactName: 'Foreign Contact',
        createdByUserId: creator.id,
      },
    }),
  ]);

  await prisma.oneTimeOrderAssignment.create({
    data: {
      oneTimeOrderId: assignedOrder.id,
      userId: manager.id,
      assignmentRoleCode: 'one_time_manager',
      isActive: true,
    },
  });

  const [assignedTask, foreignTask] = await Promise.all([
    prisma.task.create({
      data: {
        title: `${searchTerm} assigned task`,
        priority: 'normal',
        status: 'open',
        objectId: assignedObject.id,
        createdByUserId: creator.id,
        visibilityMode: 'scope',
      },
    }),
    prisma.task.create({
      data: {
        title: `${searchTerm} foreign task`,
        priority: 'normal',
        status: 'open',
        objectId: foreignObject.id,
        createdByUserId: creator.id,
        visibilityMode: 'scope',
      },
    }),
  ]);

  const [employee, candidate] = await Promise.all([
    prisma.employee.create({
      data: {
        fullName: `${searchTerm} employee`,
        phone: `+7999${marker}`,
        employmentStatus: 'active',
      },
    }),
    prisma.candidate.create({
      data: {
        fullName: `${searchTerm} candidate`,
        phone: `+7888${marker}`,
        createdByUserId: creator.id,
      },
    }),
  ]);

  t.after(async () => {
    await prisma.task.deleteMany({ where: { id: { in: [assignedTask.id, foreignTask.id] } } });
    await prisma.oneTimeOrderAssignment.deleteMany({
      where: { oneTimeOrderId: { in: [assignedOrder.id, foreignOrder.id] } },
    });
    await prisma.oneTimeOrder.deleteMany({ where: { id: { in: [assignedOrder.id, foreignOrder.id] } } });
    await prisma.objectAssignment.deleteMany({
      where: { objectId: { in: [assignedObject.id, foreignObject.id] } },
    });
    await prisma.object.deleteMany({ where: { id: { in: [assignedObject.id, foreignObject.id] } } });
    await prisma.candidate.deleteMany({ where: { id: candidate.id } });
    await prisma.employee.deleteMany({ where: { id: employee.id } });
    await prisma.user.deleteMany({ where: { id: { in: [manager.id, hr.id, creator.id] } } });
    await app.close();
    await prisma.$disconnect();
  });

  const [managerCookie, hrCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: manager.login, password }),
    loginAndGetCookieHeader({ baseUrl, login: hr.login, password }),
  ]);

  const managerResponse = await fetch(
    `${baseUrl}/api/v1/search?q=${encodeURIComponent(searchTerm)}&limit=8`,
    { headers: { Cookie: managerCookie } },
  );
  assert.equal(managerResponse.status, 200);
  const managerBody = (await managerResponse.json()) as {
    items: Array<{ id: string; type: string }>;
  };
  const managerIds = new Set(managerBody.items.map((item) => item.id));
  assert.equal(managerIds.has(assignedObject.id), true);
  assert.equal(managerIds.has(assignedOrder.id), true);
  assert.equal(managerIds.has(assignedTask.id), true);
  assert.equal(managerIds.has(foreignObject.id), false);
  assert.equal(managerIds.has(foreignOrder.id), false);
  assert.equal(managerIds.has(foreignTask.id), false);

  const recentResponse = await fetch(`${baseUrl}/api/v1/search/recent`, {
    method: 'POST',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refs: [
        { type: 'object', id: assignedObject.id },
        { type: 'object', id: foreignObject.id },
        { type: 'one_time_order', id: assignedOrder.id },
        { type: 'one_time_order', id: foreignOrder.id },
        { type: 'task', id: assignedTask.id },
        { type: 'task', id: foreignTask.id },
      ],
    }),
  });
  assert.equal(recentResponse.status, 201);
  const recentItems = (await recentResponse.json()) as Array<{ id: string }>;
  assert.deepEqual(
    recentItems.map((item) => item.id),
    [assignedObject.id, assignedOrder.id, assignedTask.id],
  );

  const hrResponse = await fetch(
    `${baseUrl}/api/v1/search?q=${encodeURIComponent(searchTerm)}&limit=8`,
    { headers: { Cookie: hrCookie } },
  );
  assert.equal(hrResponse.status, 200);
  const hrBody = (await hrResponse.json()) as {
    items: Array<{ id: string; type: string }>;
  };
  const hrIds = new Set(hrBody.items.map((item) => item.id));
  assert.equal(hrIds.has(employee.id), true);
  assert.equal(hrIds.has(candidate.id), true);

  const shortQuery = await fetch(`${baseUrl}/api/v1/search?q=x`, {
    headers: { Cookie: managerCookie },
  });
  assert.equal(shortQuery.status, 400);
});
