import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('counterparty movement filters apply before pagination and cannot widen object visibility', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `counterparty-movement-filter-${Date.now()}`;
  const [founder, manager] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
  ]);
  const counterparty = await prisma.counterparty.create({
    data: { name: marker, createdByUserId: founder.id },
  });
  const [visibleObject, hiddenObject] = await Promise.all([
    prisma.object.create({
      data: {
        name: `${marker}-visible`,
        address: 'Москва',
        status: 'active',
        dailyRate: 0,
        createdByUserId: founder.id,
        counterpartyId: counterparty.id,
        assignments: {
          create: {
            userId: manager.id,
            assignmentRoleCode: 'manager',
            isActive: true,
          },
        },
      },
    }),
    prisma.object.create({
      data: {
        name: `${marker}-hidden`,
        address: 'Москва',
        status: 'active',
        dailyRate: 0,
        createdByUserId: founder.id,
        counterpartyId: counterparty.id,
      },
    }),
  ]);
  const item = await prisma.inventoryItem.create({
    data: {
      name: marker,
      category: 'test',
      unit: 'шт.',
      createdByUserId: founder.id,
    },
  });
  const createMovement = (input: {
    objectId: string;
    movementType: string;
    createdAt: string;
  }) =>
    prisma.inventoryMovement.create({
      data: {
        inventoryItemId: item.id,
        movementType: input.movementType,
        quantity: 1,
        unitPriceSnapshot: 10,
        totalAmountSnapshot: 10,
        status: 'applied',
        createdByUserId: founder.id,
        relatedObjectId: input.objectId,
        createdAt: new Date(input.createdAt),
      },
    });
  const [firstMatch, secondMatch] = await Promise.all([
    createMovement({
      objectId: visibleObject.id,
      movementType: 'receipt',
      createdAt: '2026-10-11T21:00:00.000Z',
    }),
    createMovement({
      objectId: visibleObject.id,
      movementType: 'receipt',
      createdAt: '2026-10-12T20:59:59.999Z',
    }),
  ]);
  await Promise.all([
    createMovement({
      objectId: visibleObject.id,
      movementType: 'receipt',
      createdAt: '2026-10-11T20:59:59.999Z',
    }),
    createMovement({
      objectId: visibleObject.id,
      movementType: 'return',
      createdAt: '2026-10-12T12:00:00.000Z',
    }),
    createMovement({
      objectId: visibleObject.id,
      movementType: 'receipt',
      createdAt: '2026-10-12T21:00:00.000Z',
    }),
    createMovement({
      objectId: hiddenObject.id,
      movementType: 'receipt',
      createdAt: '2026-10-12T12:00:00.000Z',
    }),
  ]);

  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const cookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'manager1',
    password: 'manager123',
  });
  const request = async (query: string) =>
    fetch(
      `${baseUrl}/api/v1/counterparties/${counterparty.id}/inventory-movements?${query}`,
      { headers: { Cookie: cookie } },
    );

  const filtered = await request(
    `dateFrom=2026-10-12&dateTo=2026-10-12&objectId=${visibleObject.id}&movementType=receipt&page=1&limit=1`,
  );
  assert.equal(filtered.status, 200);
  const result = (await filtered.json()) as {
    items: Array<{ id: string; relatedObject: { id: string } | null }>;
    total: number;
    totalPages: number;
    page: number;
    limit: number;
  };
  assert.equal(result.total, 2);
  assert.equal(result.totalPages, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.page, 1);
  assert.equal(result.limit, 1);
  assert.ok([firstMatch.id, secondMatch.id].includes(result.items[0]!.id));
  assert.equal(result.items[0]!.relatedObject?.id, visibleObject.id);

  const moscowDay = await request(
    `dateFrom=2026-10-12&dateTo=2026-10-12&objectId=${visibleObject.id}&movementType=receipt&limit=50`,
  );
  assert.equal(moscowDay.status, 200);
  const moscowDayResult = (await moscowDay.json()) as {
    items: Array<{ id: string }>;
    total: number;
  };
  assert.equal(moscowDayResult.total, 2);
  assert.deepEqual(
    moscowDayResult.items.map((movement) => movement.id),
    [secondMatch.id, firstMatch.id],
  );

  const hiddenObjectFilter = await request(`objectId=${hiddenObject.id}`);
  assert.equal(hiddenObjectFilter.status, 200);
  assert.equal(((await hiddenObjectFilter.json()) as { total: number }).total, 0);

  const unfilteredVisibleOnly = await request('limit=50');
  assert.equal(unfilteredVisibleOnly.status, 200);
  const visibleOnly = (await unfilteredVisibleOnly.json()) as {
    items: Array<{ relatedObject: { id: string } | null }>;
  };
  assert.ok(
    visibleOnly.items.every(
      (movement) => movement.relatedObject?.id === visibleObject.id,
    ),
  );

  for (const query of [
    'dateFrom=2026-02-30',
    'dateFrom=2026-10-13&dateTo=2026-10-12',
    'movementType=not-a-movement',
  ]) {
    const invalid = await request(query);
    assert.equal(invalid.status, 400);
  }
});
