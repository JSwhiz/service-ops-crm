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

test('one-time order calendar handles 100 managers and 1000 monthly orders', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `calendar-scale-${Date.now()}`;
  const [founder, managerRole] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'manager' } }),
  ]);
  const managerIds = Array.from({ length: 100 }, () => randomUUID());
  const orderIds = Array.from({ length: 1000 }, () => randomUUID());

  t.after(async () => {
    await prisma.oneTimeOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.user.deleteMany({ where: { id: { in: managerIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  await prisma.user.createMany({
    data: managerIds.map((id, index) => ({
      id,
      login: `${marker}-${index}`,
      fullName: `${marker} Менеджер ${String(index).padStart(3, '0')}`,
      isActive: true,
    })),
  });
  await prisma.userRole.createMany({
    data: managerIds.map((userId) => ({ userId, roleId: managerRole.id })),
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
  const benchmarkManagers = calendar.managers.filter((manager) =>
    manager.user.fullName.startsWith(marker),
  );
  assert.equal(calendar.daysInMonth, 31);
  assert.equal(benchmarkManagers.length, 100);
  assert.equal(
    benchmarkManagers.reduce((total, manager) => total + manager.orderCount, 0),
    1000,
  );
  assert.ok(benchmarkManagers.every((manager) => manager.days.length === 31));
  assert.ok(elapsedMs < 15_000, `Calendar response took ${Math.round(elapsedMs)}ms`);
});
