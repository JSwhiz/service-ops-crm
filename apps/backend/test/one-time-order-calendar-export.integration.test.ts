import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('one-time order calendar export is valid, filtered and access-safe', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `calendar-export-${Date.now()}`;
  const [founder, managerOne, managerTwo] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } }),
  ]);
  const orders = await Promise.all([
    prisma.oneTimeOrder.create({
      data: {
        title: `${marker}-visible`,
        executionAddress: 'Видимый адрес',
        status: 'planned',
        executionStartDate: new Date('2042-07-10T00:00:00.000Z'),
        executionEndDate: new Date('2042-07-10T00:00:00.000Z'),
        contactName: 'Видимый контакт',
        createdByUserId: founder.id,
        assignments: {
          create: {
            userId: managerOne.id,
            assignmentRoleCode: 'one_time_manager',
            isActive: true,
          },
        },
      },
    }),
    prisma.oneTimeOrder.create({
      data: {
        title: `${marker}-cancelled`,
        executionAddress: 'Отменённый адрес',
        status: 'cancelled',
        executionStartDate: new Date('2042-07-11T00:00:00.000Z'),
        executionEndDate: new Date('2042-07-11T00:00:00.000Z'),
        contactName: 'Отменённый контакт',
        createdByUserId: founder.id,
        assignments: {
          create: {
            userId: managerOne.id,
            assignmentRoleCode: 'one_time_manager',
            isActive: true,
          },
        },
      },
    }),
    prisma.oneTimeOrder.create({
      data: {
        title: `${marker}-hidden`,
        executionAddress: 'Скрытый адрес',
        status: 'completed',
        executionStartDate: new Date('2042-07-12T00:00:00.000Z'),
        executionEndDate: new Date('2042-07-12T00:00:00.000Z'),
        contactName: 'Скрытый контакт',
        createdByUserId: founder.id,
        assignments: {
          create: {
            userId: managerTwo.id,
            assignmentRoleCode: 'one_time_manager',
            isActive: true,
          },
        },
      },
    }),
  ]);

  t.after(async () => {
    await prisma.oneTimeOrder.deleteMany({
      where: { id: { in: orders.map((order) => order.id) } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  const [founderCookie, managerCookie] = await Promise.all([
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
  ]);
  const exportCalendar = async (cookie: string, query: string) => {
    const response = await fetch(
      `${baseUrl}/api/v1/one-time-orders/calendar/export.xlsx?${query}`,
      { headers: { Cookie: cookie } },
    );
    const buffer = Buffer.from(await response.arrayBuffer());
    return { response, buffer, raw: buffer.toString('utf8') };
  };

  for (const month of ['2041-02', '2044-02', '2042-04', '2042-07']) {
    const exported = await exportCalendar(founderCookie, `month=${month}`);
    assert.equal(exported.response.status, 200);
    assert.equal(
      exported.response.headers.get('content-type'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    assert.match(
      exported.response.headers.get('content-disposition') ?? '',
      new RegExp(`one-time-orders-calendar-${month}\\.xlsx`),
    );
    assert.equal(exported.buffer.subarray(0, 2).toString(), 'PK');
    assert.match(exported.raw, /Календарь/);
    assert.match(exported.raw, /Заказы/);
  }

  const ordinaryDefault = await exportCalendar(managerCookie, 'month=2042-07');
  assert.match(ordinaryDefault.raw, new RegExp(`${marker}-visible`));
  assert.doesNotMatch(ordinaryDefault.raw, new RegExp(`${marker}-cancelled`));
  assert.doesNotMatch(ordinaryDefault.raw, new RegExp(`${marker}-hidden`));
  assert.match(ordinaryDefault.raw, /Занят/);

  const ordinaryWithCancelled = await exportCalendar(
    managerCookie,
    'month=2042-07&includeCancelled=true',
  );
  assert.match(ordinaryWithCancelled.raw, new RegExp(`${marker}-cancelled`));
  assert.doesNotMatch(ordinaryWithCancelled.raw, /Скрытый адрес/);
  assert.doesNotMatch(ordinaryWithCancelled.raw, /Скрытый контакт/);

  const leadership = await exportCalendar(
    founderCookie,
    'month=2042-07&includeCancelled=true',
  );
  assert.match(leadership.raw, new RegExp(`${marker}-hidden`));

  const managerFiltered = await exportCalendar(
    founderCookie,
    `month=2042-07&managerUserId=${managerTwo.id}`,
  );
  assert.match(managerFiltered.raw, new RegExp(`${marker}-hidden`));
  assert.doesNotMatch(managerFiltered.raw, new RegExp(`${marker}-visible`));

  const statusFiltered = await exportCalendar(
    founderCookie,
    'month=2042-07&status=completed',
  );
  assert.match(statusFiltered.raw, new RegExp(`${marker}-hidden`));
  assert.doesNotMatch(statusFiltered.raw, new RegExp(`${marker}-visible`));
});
