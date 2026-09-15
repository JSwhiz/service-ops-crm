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
  const rankingTerm = `rank-${marker}`;
  const taskRankingTerm = `task-rank-${marker}`;
  const phoneTail = String(parseInt(marker, 16) % 10_000_000).padStart(7, '0');
  const formatPhone = (code: string): string =>
    `+7 (${code}) ${phoneTail.slice(0, 3)}-${phoneTail.slice(3, 5)}-${phoneTail.slice(5)}`;
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
        contactPhone: formatPhone('904'),
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
        phone: formatPhone('901'),
        employmentStatus: 'active',
      },
    }),
    prisma.candidate.create({
      data: {
        fullName: `${searchTerm} candidate`,
        phone: formatPhone('902'),
        createdByUserId: creator.id,
      },
    }),
  ]);

  const [counterparty, inventoryItem, equipmentCatalogItem] = await Promise.all([
    prisma.counterparty.create({
      data: {
        name: `${searchTerm} counterparty`,
        legalName: `ООО ${searchTerm}`,
        contactName: 'Search Contact',
        contactPhone: formatPhone('903'),
        createdByUserId: creator.id,
      },
    }),
    prisma.inventoryItem.create({
      data: {
        name: `${searchTerm} inventory`,
        category: 'Search materials',
        unit: 'шт',
        createdByUserId: creator.id,
      },
    }),
    prisma.equipmentCatalogItem.create({
      data: {
        category: 'Search equipment',
        name: `${searchTerm} equipment`,
        brand: 'SearchBrand',
        model: marker,
        createdByUserId: creator.id,
      },
    }),
  ]);

  const equipmentUnit = await prisma.equipmentUnit.create({
    data: {
      catalogItemId: equipmentCatalogItem.id,
      inventoryNumber: `SEARCH-${marker}`,
      serialNumber: `SERIAL-${marker}`,
      createdByUserId: creator.id,
    },
  });

  await prisma.object.update({
    where: { id: assignedObject.id },
    data: {
      counterpartyId: counterparty.id,
      name: rankingTerm,
    },
  });

  const [prefixObject, containsObject, descriptionRankTask, prefixRankTask, containsCounterparty] =
    await Promise.all([
      prisma.object.create({
        data: {
          name: `${rankingTerm} филиал`,
          address: `Prefix ${rankingTerm}`,
          status: 'active',
          createdByUserId: creator.id,
        },
      }),
      prisma.object.create({
        data: {
          name: `Объект ${rankingTerm} архив`,
          address: `Contains ${rankingTerm}`,
          status: 'active',
          createdByUserId: creator.id,
        },
      }),
      prisma.task.create({
        data: {
          title: `Описание ranking ${marker}`,
          description: taskRankingTerm,
          priority: 'normal',
          status: 'open',
          objectId: assignedObject.id,
          createdByUserId: creator.id,
          visibilityMode: 'scope',
        },
      }),
      prisma.task.create({
        data: {
          title: `${taskRankingTerm} задача`,
          priority: 'normal',
          status: 'open',
          objectId: assignedObject.id,
          createdByUserId: creator.id,
          visibilityMode: 'scope',
        },
      }),
      prisma.counterparty.create({
        data: {
          name: `Контрагент ${rankingTerm}`,
          createdByUserId: creator.id,
        },
      }),
    ]);

  await prisma.objectAssignment.createMany({
    data: [
      {
        objectId: prefixObject.id,
        userId: manager.id,
        assignmentRoleCode: 'manager',
        isActive: true,
      },
      {
        objectId: containsObject.id,
        userId: manager.id,
        assignmentRoleCode: 'manager',
        isActive: true,
      },
    ],
  });

  t.after(async () => {
    await prisma.task.deleteMany({
      where: {
        id: {
          in: [
            assignedTask.id,
            foreignTask.id,
            descriptionRankTask.id,
            prefixRankTask.id,
          ],
        },
      },
    });
    await prisma.oneTimeOrderAssignment.deleteMany({
      where: { oneTimeOrderId: { in: [assignedOrder.id, foreignOrder.id] } },
    });
    await prisma.oneTimeOrder.deleteMany({ where: { id: { in: [assignedOrder.id, foreignOrder.id] } } });
    await prisma.objectAssignment.deleteMany({
      where: {
        objectId: {
          in: [
            assignedObject.id,
            foreignObject.id,
            prefixObject.id,
            containsObject.id,
          ],
        },
      },
    });
    await prisma.object.deleteMany({
      where: {
        id: {
          in: [
            assignedObject.id,
            foreignObject.id,
            prefixObject.id,
            containsObject.id,
          ],
        },
      },
    });
    await prisma.equipmentUnit.deleteMany({ where: { id: equipmentUnit.id } });
    await prisma.equipmentCatalogItem.deleteMany({ where: { id: equipmentCatalogItem.id } });
    await prisma.inventoryItem.deleteMany({ where: { id: inventoryItem.id } });
    await prisma.counterparty.deleteMany({
      where: { id: { in: [counterparty.id, containsCounterparty.id] } },
    });
    await prisma.candidate.deleteMany({ where: { id: candidate.id } });
    await prisma.employee.deleteMany({ where: { id: employee.id } });
    await prisma.user.deleteMany({ where: { id: { in: [manager.id, hr.id, creator.id] } } });
    await app.close();
    await prisma.$disconnect();
  });

  const [managerCookie, hrCookie, founderCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: manager.login, password }),
    loginAndGetCookieHeader({ baseUrl, login: hr.login, password }),
    loginAndGetCookieHeader({ baseUrl, login: creator.login, password }),
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
  assert.equal(managerIds.has(counterparty.id), true);
  assert.equal(managerIds.has(inventoryItem.id), true);
  assert.equal(managerIds.has(equipmentUnit.id), true);

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
  assert.equal(recentResponse.status, 200);
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
  assert.equal(hrIds.has(counterparty.id), true);
  assert.equal(hrIds.has(inventoryItem.id), false);
  assert.equal(hrIds.has(equipmentUnit.id), false);

  const founderRecentResponse = await fetch(`${baseUrl}/api/v1/search/recent`, {
    method: 'POST',
    headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refs: [
        { type: 'object', id: assignedObject.id },
        { type: 'one_time_order', id: assignedOrder.id },
        { type: 'task', id: assignedTask.id },
        { type: 'employee', id: employee.id },
        { type: 'candidate', id: candidate.id },
        { type: 'counterparty', id: counterparty.id },
        { type: 'inventory_item', id: inventoryItem.id },
        { type: 'equipment_unit', id: equipmentUnit.id },
      ],
    }),
  });
  assert.equal(founderRecentResponse.status, 200);
  const founderRecentItems = (await founderRecentResponse.json()) as Array<{
    id: string;
    type: string;
  }>;
  assert.deepEqual(
    founderRecentItems.map((item) => [item.type, item.id]),
    [
      ['object', assignedObject.id],
      ['one_time_order', assignedOrder.id],
      ['task', assignedTask.id],
      ['employee', employee.id],
      ['candidate', candidate.id],
      ['counterparty', counterparty.id],
      ['inventory_item', inventoryItem.id],
      ['equipment_unit', equipmentUnit.id],
    ],
  );

  const rankingResponse = await fetch(
    `${baseUrl}/api/v1/search?q=${encodeURIComponent(rankingTerm)}&limit=8`,
    { headers: { Cookie: managerCookie } },
  );
  assert.equal(rankingResponse.status, 200);
  const rankingBody = (await rankingResponse.json()) as {
    items: Array<{ id: string; type: string }>;
  };
  const rankedObjects = rankingBody.items
    .filter((item) => item.type === 'object')
    .map((item) => item.id);
  assert.deepEqual(rankedObjects.slice(0, 3), [
    assignedObject.id,
    prefixObject.id,
    containsObject.id,
  ]);

  const taskRankingResponse = await fetch(
    `${baseUrl}/api/v1/search?q=${encodeURIComponent(taskRankingTerm)}&limit=8`,
    { headers: { Cookie: managerCookie } },
  );
  assert.equal(taskRankingResponse.status, 200);
  const taskRankingBody = (await taskRankingResponse.json()) as {
    items: Array<{ id: string; type: string }>;
  };
  const rankedTasks = taskRankingBody.items
    .filter((item) => item.type === 'task')
    .map((item) => item.id);
  assert.equal(rankedTasks.indexOf(descriptionRankTask.id) >= 0, true);
  assert.equal(rankedTasks.indexOf(prefixRankTask.id) >= 0, true);
  assert.equal(
    rankedTasks.indexOf(descriptionRankTask.id) <
      rankedTasks.indexOf(prefixRankTask.id),
    true,
  );

  const rankedCounterparties = rankingBody.items
    .filter((item) => item.type === 'counterparty')
    .map((item) => item.id);
  assert.equal(rankedCounterparties.indexOf(counterparty.id) >= 0, true);
  assert.equal(rankedCounterparties.indexOf(containsCounterparty.id) >= 0, true);
  assert.equal(
    rankedCounterparties.indexOf(counterparty.id) <
      rankedCounterparties.indexOf(containsCounterparty.id),
    true,
  );

  for (const [digits, expectedId, expectedType] of [
    [`8901${phoneTail}`, employee.id, 'employee'],
    [`8902${phoneTail}`, candidate.id, 'candidate'],
    [`8903${phoneTail}`, counterparty.id, 'counterparty'],
    [`8904${phoneTail}`, assignedOrder.id, 'one_time_order'],
  ] as const) {
    const response = await fetch(
      `${baseUrl}/api/v1/search?q=${encodeURIComponent(digits)}&limit=8`,
      { headers: { Cookie: founderCookie } },
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      items: Array<{ id: string; type: string }>;
    };
    assert.equal(
      body.items.some(
        (item) => item.id === expectedId && item.type === expectedType,
      ),
      true,
    );
  }

  const shortQuery = await fetch(`${baseUrl}/api/v1/search?q=x`, {
    headers: { Cookie: managerCookie },
  });
  assert.equal(shortQuery.status, 400);
});
