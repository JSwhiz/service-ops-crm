import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('one-time order registry filters undated orders and orders without an active manager before pagination', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `order-filter-${Date.now()}`;
  const founder = await prisma.user.findUniqueOrThrow({
    where: { login: 'founder' },
  });
  const manager = await prisma.user.findUniqueOrThrow({
    where: { login: 'manager1' },
  });

  t.after(async () => {
    await prisma.oneTimeOrder.deleteMany({
      where: { title: { startsWith: marker } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  const undatedUnassigned = await prisma.oneTimeOrder.create({
    data: {
      title: `${marker}-undated-unassigned`,
      executionAddress: 'Москва',
      status: 'in_progress',
      contactName: 'Контакт',
      createdByUserId: founder.id,
    },
  });
  const undatedInactiveAssignment = await prisma.oneTimeOrder.create({
    data: {
      title: `${marker}-undated-inactive-assignment`,
      executionAddress: 'Москва',
      status: 'in_progress',
      contactName: 'Контакт',
      createdByUserId: founder.id,
      assignments: {
        create: {
          userId: manager.id,
          assignmentRoleCode: 'one_time_manager',
          isActive: false,
        },
      },
    },
  });
  await prisma.oneTimeOrder.create({
    data: {
      title: `${marker}-undated-active-assignment`,
      executionAddress: 'Москва',
      status: 'in_progress',
      contactName: 'Контакт',
      createdByUserId: founder.id,
      assignments: {
        create: {
          userId: manager.id,
          assignmentRoleCode: 'one_time_manager',
          isActive: true,
        },
      },
    },
  });
  await prisma.oneTimeOrder.create({
    data: {
      title: `${marker}-dated-unassigned`,
      executionAddress: 'Москва',
      executionDate: new Date('2026-10-20T00:00:00.000Z'),
      status: 'in_progress',
      contactName: 'Контакт',
      createdByUserId: founder.id,
    },
  });

  const cookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'founder',
    password: 'founder123',
  });
  const request = async (query: string) => {
    const response = await fetch(
      `${baseUrl}/api/v1/one-time-orders?q=${marker}&${query}`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()) as {
      items: Array<{ id: string }>;
      total: number;
      page: number;
      limit: number;
    };
  };

  const undated = await request('withoutDate=true&limit=1&page=1');
  assert.equal(undated.total, 3);
  assert.equal(undated.items.length, 1);
  assert.equal(undated.page, 1);
  assert.equal(undated.limit, 1);

  const withoutActiveManager = await request(
    'withoutActiveManager=true&limit=20',
  );
  assert.equal(withoutActiveManager.total, 3);
  const withoutManagerIds = new Set(
    withoutActiveManager.items.map((item) => item.id),
  );
  assert.ok(withoutManagerIds.has(undatedUnassigned.id));
  assert.ok(withoutManagerIds.has(undatedInactiveAssignment.id));
  assert.ok(
    !withoutManagerIds.has(
      (
        await prisma.oneTimeOrder.findFirstOrThrow({
          where: { title: `${marker}-undated-active-assignment` },
          select: { id: true },
        })
      ).id,
    ),
  );

  const combined = await request(
    'status=in_progress&withoutDate=true&withoutActiveManager=true&limit=20',
  );
  assert.equal(combined.total, 2);
  assert.equal(combined.items.length, 2);

  const invalidBoolean = await fetch(
    `${baseUrl}/api/v1/one-time-orders?withoutDate=perhaps`,
    { headers: { Cookie: cookie } },
  );
  assert.equal(invalidBoolean.status, 400);
});
