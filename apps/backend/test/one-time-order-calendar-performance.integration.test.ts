import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface CalendarResponse {
  daysInMonth: number;
  managers: Array<{
    user: { fullName: string };
    orderCount: number;
    days: unknown[];
  }>;
}

test('one-time order calendar handles the configured roster and 1000 monthly orders', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `calendar-scale-${Date.now()}`;
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const roster = await prisma.oneTimeOrderCalendarManager.findMany({
    where: { isVisible: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  const managerIds = roster.map(({ userId }) => userId);
  assert.equal(managerIds.length, 6);
  const orderIds = Array.from({ length: 1000 }, () => randomUUID());

  t.after(async () => {
    await prisma.oneTimeOrder.deleteMany({ where: { id: { in: orderIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  await prisma.oneTimeOrder.createMany({
    data: orderIds.map((id, index) => {
      const day = (index % 31) + 1;
      return {
        id,
        title: `${marker}-order-${index}`,
        executionAddress: 'Москва',
        status: index % 5 === 0 ? 'completed' : 'planned',
        executionStartDate: new Date(Date.UTC(2051, 0, day)),
        executionEndDate: new Date(Date.UTC(2051, 0, day)),
        contactName: 'Контакт',
        createdByUserId: founder.id,
      };
    }),
  });
  await prisma.oneTimeOrderAssignment.createMany({
    data: orderIds.map((oneTimeOrderId, index) => ({
      oneTimeOrderId,
      userId: managerIds[index % managerIds.length]!,
      assignmentRoleCode: 'one_time_manager',
      isActive: true,
    })),
  });

  const cookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'founder',
    password: 'founder123',
  });
  const startedAt = performance.now();
  const response = await fetch(
    `${baseUrl}/api/v1/one-time-orders/calendar?month=2051-01`,
    { headers: { Cookie: cookie } },
  );
  const elapsedMs = performance.now() - startedAt;

  assert.equal(response.status, 200);
  const calendar = (await response.json()) as CalendarResponse;
  const benchmarkManagers = calendar.managers;
  assert.equal(calendar.daysInMonth, 31);
  assert.equal(benchmarkManagers.length, 6);
  assert.equal(
    benchmarkManagers.reduce((total, manager) => total + manager.orderCount, 0),
    1000,
  );
  assert.ok(benchmarkManagers.every((manager) => manager.days.length === 31));
  assert.ok(elapsedMs < 15_000, `Calendar response took ${Math.round(elapsedMs)}ms`);
});
