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
    prisma.user.findUniqueOrThrow({ where: { login: 'drozdovskiy' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'berendyakov' } }),
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
        reviewRating: 5,
        reviewText: `${marker}-private-review-text`,
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
  const privateAvailability = await prisma.oneTimeManagerAvailability.create({
    data: {
      userId: managerOne.id,
      entryType: 'sick_leave',
      startDate: new Date('2042-07-13T00:00:00.000Z'),
      endDate: new Date('2042-07-13T00:00:00.000Z'),
      status: 'approved',
      requestComment: `${marker}-private-availability-comment`,
      resolutionComment: `${marker}-private-resolution-comment`,
      requestedByUserId: managerOne.id,
      resolvedByUserId: founder.id,
      resolvedAt: new Date(),
    },
  });

  t.after(async () => {
    await prisma.oneTimeManagerAvailability.delete({
      where: { id: privateAvailability.id },
    });
    await prisma.oneTimeOrder.deleteMany({
      where: { id: { in: orders.map((order) => order.id) } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  const [founderCookie, managerCookie, otherManagerCookie] = await Promise.all([
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
  assert.match(ordinaryDefault.raw, /state="frozen"/);
  assert.match(ordinaryDefault.raw, /orientation="landscape"/);
  assert.match(ordinaryDefault.raw, /wrapText="1"/);
  assert.match(ordinaryDefault.raw, /Отзыв/);
  assert.match(ordinaryDefault.raw, new RegExp(`${marker}-private-review-text`));
  assert.doesNotMatch(
    ordinaryDefault.raw,
    new RegExp(`${marker}-private-availability-comment`),
  );

  const otherManagerExport = await exportCalendar(
    otherManagerCookie,
    'month=2042-07',
  );
  assert.doesNotMatch(
    otherManagerExport.raw,
    new RegExp(`${marker}-private-availability-comment`),
  );
  assert.doesNotMatch(
    otherManagerExport.raw,
    new RegExp(`${marker}-private-resolution-comment`),
  );

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
  assert.match(leadership.raw, /Отменённый заказ/);
  assert.match(leadership.raw, /День недели/);
  assert.match(leadership.raw, /10 Чт/);

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
