import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface CalendarDay {
  date: string;
  availability: { entryType: string } | null;
  pendingOwnRequest: { entryType: string } | null;
  orders: Array<{
    detailsRestricted: boolean;
    relatedOrder: {
      id: string;
      title: string;
      status: string;
      executionAddress: string;
      managers: Array<{ id: string; fullName: string }>;
    } | null;
  }>;
  conflictLevel: string;
}

interface CalendarManagerRow {
  user: { id: string; fullName: string };
  isActive: boolean;
  workedDays: number;
  orderCount: number;
  completedOrderCount: number;
  cancelledOrderCount: number;
  days: CalendarDay[];
}

interface CalendarResponse {
  month: string;
  daysInMonth: number;
  managers: CalendarManagerRow[];
}

test('one-time order calendar expands ranges and protects pending availability', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `calendar-${Date.now()}`;
  const [founder, managerOne, managerTwo] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } }),
  ]);
  const inactiveManager = await prisma.user.create({
    data: {
      login: `${marker}-inactive`,
      fullName: `${marker} Неактивный менеджер`,
      isActive: false,
    },
  });
  const orderData = [
    {
      title: `${marker}-multi`,
      status: 'in_progress',
      start: '2032-07-10',
      end: '2032-07-12',
      managers: [managerOne.id, managerTwo.id],
    },
    {
      title: `${marker}-completed`,
      status: 'completed',
      start: '2032-07-11',
      end: '2032-07-11',
      managers: [managerOne.id],
    },
    {
      title: `${marker}-cancelled`,
      status: 'cancelled',
      start: '2032-07-11',
      end: '2032-07-11',
      managers: [managerOne.id],
    },
    {
      title: `${marker}-boundary`,
      status: 'planned',
      start: '2032-06-30',
      end: '2032-07-01',
      managers: [managerOne.id],
    },
    {
      title: `${marker}-historical`,
      status: 'completed',
      start: '2032-07-05',
      end: '2032-07-05',
      managers: [inactiveManager.id],
    },
    {
      title: `${marker}-manager-two-private`,
      status: 'planned',
      start: '2032-07-11',
      end: '2032-07-11',
      managers: [managerTwo.id],
    },
  ];
  const orders = await Promise.all(
    orderData.map((item) =>
      prisma.oneTimeOrder.create({
        data: {
          title: item.title,
          executionAddress: 'Москва',
          status: item.status,
          executionStartDate: new Date(`${item.start}T00:00:00.000Z`),
          executionEndDate: new Date(`${item.end}T00:00:00.000Z`),
          contactName: 'Контакт',
          createdByUserId: founder.id,
          assignments: {
            create: item.managers.map((userId) => ({
              userId,
              assignmentRoleCode: 'one_time_manager',
              isActive: userId !== inactiveManager.id,
            })),
          },
        },
      }),
    ),
  );
  const availability = await Promise.all([
    prisma.oneTimeManagerAvailability.create({
      data: {
        userId: managerOne.id,
        entryType: 'vacation',
        startDate: new Date('2032-07-11T00:00:00.000Z'),
        endDate: new Date('2032-07-11T00:00:00.000Z'),
        status: 'approved',
        requestedByUserId: founder.id,
        resolvedByUserId: founder.id,
        resolvedAt: new Date(),
      },
    }),
    prisma.oneTimeManagerAvailability.create({
      data: {
        userId: managerOne.id,
        entryType: 'day_off',
        startDate: new Date('2032-07-13T00:00:00.000Z'),
        endDate: new Date('2032-07-13T00:00:00.000Z'),
        status: 'pending',
        requestedByUserId: managerOne.id,
      },
    }),
    prisma.oneTimeManagerAvailability.create({
      data: {
        userId: managerTwo.id,
        entryType: 'sick_leave',
        startDate: new Date('2032-07-12T00:00:00.000Z'),
        endDate: new Date('2032-07-12T00:00:00.000Z'),
        status: 'pending',
        requestedByUserId: managerTwo.id,
      },
    }),
  ]);

  t.after(async () => {
    await prisma.oneTimeManagerAvailability.deleteMany({
      where: { id: { in: availability.map((entry) => entry.id) } },
    });
    await prisma.oneTimeOrder.deleteMany({
      where: { id: { in: orders.map((order) => order.id) } },
    });
    await prisma.user.delete({ where: { id: inactiveManager.id } });
    await app.close();
    await prisma.$disconnect();
  });

  const [founderCookie, managerCookie, hrCookie] = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: 'founder',
      password: 'founder123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: 'manager1',
      password: 'manager123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: 'hr1',
      password: 'hr123',
    }),
  ]);
  const getCalendar = async (cookie: string, query = 'month=2032-07') => {
    const response = await fetch(
      `${baseUrl}/api/v1/one-time-orders/calendar?${query}`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(response.status, 200);
    return (await response.json()) as CalendarResponse;
  };

  const leadershipCalendar = await getCalendar(
    founderCookie,
    'month=2032-07&includeCancelled=true',
  );
  assert.equal(leadershipCalendar.month, '2032-07');
  assert.equal(leadershipCalendar.daysInMonth, 31);
  const managerOneRow = leadershipCalendar.managers.find(
    (row) => row.user.id === managerOne.id,
  )!;
  assert.equal(managerOneRow.workedDays, 4);
  assert.equal(managerOneRow.orderCount, 4);
  assert.equal(managerOneRow.completedOrderCount, 1);
  assert.equal(managerOneRow.cancelledOrderCount, 1);
  const julyEleventh = managerOneRow.days.find(
    (day) => day.date === '2032-07-11',
  )!;
  assert.equal(julyEleventh.orders.length, 3);
  assert.ok(
    julyEleventh.orders.some((order) =>
      order.relatedOrder?.managers.some(
        (manager) => manager.id === managerTwo.id,
      ),
    ),
  );
  assert.equal(julyEleventh.availability?.entryType, 'vacation');
  assert.equal(
    julyEleventh.conflictLevel,
    'multiple_orders_and_availability',
  );
  assert.equal(
    managerOneRow.days.find((day) => day.date === '2032-07-13')
      ?.pendingOwnRequest?.entryType,
    'day_off',
  );
  const managerTwoLeadershipRow = leadershipCalendar.managers.find(
    (row) => row.user.id === managerTwo.id,
  )!;
  assert.equal(
    managerTwoLeadershipRow.days.find((day) => day.date === '2032-07-12')
      ?.pendingOwnRequest?.entryType,
    'sick_leave',
  );
  const historicalRow = leadershipCalendar.managers.find(
    (row) => row.user.id === inactiveManager.id,
  );
  assert.equal(historicalRow, undefined);

  const ordinaryCalendar = await getCalendar(managerCookie);
  const ordinaryOwnRow = ordinaryCalendar.managers.find(
    (row) => row.user.id === managerOne.id,
  )!;
  assert.equal(
    ordinaryOwnRow.days.find((day) => day.date === '2032-07-13')
      ?.pendingOwnRequest?.entryType,
    'day_off',
  );
  const ordinaryOtherRow = ordinaryCalendar.managers.find(
    (row) => row.user.id === managerTwo.id,
  )!;
  assert.equal(
    ordinaryOtherRow.days.find((day) => day.date === '2032-07-12')
      ?.pendingOwnRequest,
    null,
  );
  assert.equal(ordinaryOwnRow.orderCount, 3);
  assert.equal(ordinaryOwnRow.cancelledOrderCount, 0);
  assert.equal(
    ordinaryOwnRow.days.find((day) => day.date === '2032-07-11')?.orders.length,
    2,
  );
  const restrictedOrder = ordinaryOtherRow.days
    .find((day) => day.date === '2032-07-11')
    ?.orders.find((order) => order.detailsRestricted);
  assert.deepEqual(restrictedOrder, {
    type: 'existing_order',
    detailsRestricted: true,
    relatedOrder: null,
  });
  assert.equal(
    JSON.stringify(restrictedOrder).includes(`${marker}-manager-two-private`),
    false,
  );

  const filteredCalendar = await getCalendar(
    founderCookie,
    `month=2032-07&managerUserId=${managerTwo.id}`,
  );
  assert.deepEqual(
    filteredCalendar.managers.map((row) => row.user.id),
    [managerTwo.id],
  );
  assert.equal(filteredCalendar.managers[0]?.workedDays, 3);

  const hrCalendar = await getCalendar(hrCookie);
  assert.equal(
    hrCalendar.managers
      .find((row) => row.user.id === managerTwo.id)
      ?.days.find((day) => day.date === '2032-07-12')?.pendingOwnRequest
      ?.entryType,
    'sick_leave',
  );

  const invalidMonth = await fetch(
    `${baseUrl}/api/v1/one-time-orders/calendar?month=2032-13`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(invalidMonth.status, 400);
});
