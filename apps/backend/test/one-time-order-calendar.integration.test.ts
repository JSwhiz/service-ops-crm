import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface CalendarDay {
  date: string;
  availability: { entryType: string; comment: string | null } | null;
  pendingRequests: Array<{ entryType: string; comment: string | null }>;
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
  const [founder, managerOne, managerTwo, hiddenManager] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'drozdovskiy' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'berendyakov' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'gerasimov' } }),
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
      title: `${marker}-cancelled-only-day`,
      status: 'cancelled',
      start: '2032-07-14',
      end: '2032-07-14',
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
    {
      title: `${marker}-manager-two-private-cancelled`,
      status: 'cancelled',
      start: '2032-07-14',
      end: '2032-07-14',
      managers: [managerTwo.id],
    },
    {
      title: `${marker}-hidden-manager`,
      status: 'planned',
      start: '2032-07-15',
      end: '2032-07-15',
      managers: [hiddenManager.id],
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
        requestComment: 'Приватный комментарий отпуска',
        resolutionComment: 'Приватное решение по отпуску',
        requestedByUserId: founder.id,
        resolvedByUserId: founder.id,
        resolvedAt: new Date(),
      },
    }),
    prisma.oneTimeManagerAvailability.create({
      data: {
        userId: hiddenManager.id,
        entryType: 'day_off',
        startDate: new Date('2032-07-15T00:00:00.000Z'),
        endDate: new Date('2032-07-15T00:00:00.000Z'),
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
        requestComment: 'Личный запрос выходного',
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
        requestComment: 'Приватный больничный',
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

  const [founderCookie, managerCookie, managerTwoCookie, hrCookie] = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: 'founder',
      password: 'founder123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
        login: 'drozdovskiy',
        password: 'drozdovskiy123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
        login: 'berendyakov',
        password: 'berendyakov123',
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
  assert.deepEqual(
    leadershipCalendar.managers.map((row) => row.user.fullName),
    [
      'Дроздовский Александр Александрович',
      'Берендяков Роман Вячеславович',
      'Гомонова Мария Николаевна',
      'Сычева Кристина Александровна',
      'Елисеева Оксана Анатольевна',
      'Милов Евгений Юрьевич',
    ],
  );
  assert.equal(
    leadershipCalendar.managers.some((row) => row.user.id === hiddenManager.id),
    false,
  );
  const managerOneRow = leadershipCalendar.managers.find(
    (row) => row.user.id === managerOne.id,
  )!;
  assert.equal(managerOneRow.workedDays, 4);
  assert.equal(managerOneRow.orderCount, 5);
  assert.equal(managerOneRow.completedOrderCount, 1);
  assert.equal(managerOneRow.cancelledOrderCount, 2);
  assert.equal(
    managerOneRow.days.find((day) => day.date === '2032-07-14')?.orders.length,
    1,
  );
  const julyEleventh = managerOneRow.days.find(
    (day) => day.date === '2032-07-11',
  )!;
  assert.equal(julyEleventh.availability?.comment, 'Приватный комментарий отпуска');
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
      ?.pendingRequests[0]?.entryType,
    'day_off',
  );
  const managerTwoLeadershipRow = leadershipCalendar.managers.find(
    (row) => row.user.id === managerTwo.id,
  )!;
  assert.equal(
    managerTwoLeadershipRow.days.find((day) => day.date === '2032-07-12')
      ?.pendingRequests[0]?.entryType,
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
      ?.pendingRequests[0]?.entryType,
    'day_off',
  );
  const ordinaryOtherRow = ordinaryCalendar.managers.find(
    (row) => row.user.id === managerTwo.id,
  )!;
  assert.deepEqual(
    ordinaryOtherRow.days.find((day) => day.date === '2032-07-12')
      ?.pendingRequests,
    [],
  );
  assert.equal(ordinaryOwnRow.orderCount, 3);
  assert.equal(ordinaryOwnRow.cancelledOrderCount, 0);
  assert.equal(
    ordinaryOwnRow.days.find((day) => day.date === '2032-07-11')?.availability
      ?.comment,
    'Приватный комментарий отпуска',
  );
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

  const ordinaryWithCancelled = await getCalendar(
    managerCookie,
    'month=2032-07&includeCancelled=true',
  );
  const ordinaryHiddenCancelledDay = ordinaryWithCancelled.managers
    .find((row) => row.user.id === managerTwo.id)
    ?.days.find((day) => day.date === '2032-07-14');
  assert.deepEqual(ordinaryHiddenCancelledDay?.orders, []);

  const otherManagerCalendar = await getCalendar(managerTwoCookie);
  assert.equal(
    otherManagerCalendar.managers
      .find((row) => row.user.id === managerOne.id)
      ?.days.find((day) => day.date === '2032-07-11')?.availability?.comment,
    null,
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

  const hiddenManagerCalendar = await getCalendar(
    founderCookie,
    `month=2032-07&managerUserId=${hiddenManager.id}`,
  );
  assert.deepEqual(hiddenManagerCalendar.managers, []);

  const hrCalendar = await getCalendar(hrCookie);
  assert.equal(
    hrCalendar.managers
      .find((row) => row.user.id === managerOne.id)
      ?.days.find((day) => day.date === '2032-07-11')?.availability?.comment,
    'Приватный комментарий отпуска',
  );
  assert.equal(
    hrCalendar.managers
      .find((row) => row.user.id === managerTwo.id)
      ?.days.find((day) => day.date === '2032-07-12')?.pendingRequests[0]
      ?.entryType,
    'sick_leave',
  );

  const invalidMonth = await fetch(
    `${baseUrl}/api/v1/one-time-orders/calendar?month=2032-13`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(invalidMonth.status, 400);
});
