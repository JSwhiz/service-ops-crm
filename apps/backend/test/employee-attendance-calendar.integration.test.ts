import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface AttendanceResponse {
  year: number;
  month: number;
  days: Array<{
    date: string;
    objects: Array<Record<string, unknown>>;
  }>;
}

test('employee attendance calendar exposes only actual shift facts for the requested month', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const marker = randomUUID();
  const [hrCookie, managerCookie, founder] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'hr1', password: 'hr123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
    prisma.user.findFirstOrThrow({ where: { login: 'founder' } }),
  ]);
  const [employee, firstObject, secondObject] = await Promise.all([
    prisma.employee.create({
      data: { fullName: `Выходы ${marker}`, employmentStatus: 'active' },
    }),
    prisma.object.create({
      data: {
        name: `Объект А ${marker}`,
        internalName: `ATT-A-${marker}`,
        address: `Адрес А ${marker}`,
        status: 'active',
        dailyRate: 2500,
        createdByUserId: founder.id,
      },
    }),
    prisma.object.create({
      data: {
        name: `Объект Б ${marker}`,
        internalName: `ATT-B-${marker}`,
        address: `Адрес Б ${marker}`,
        status: 'active',
        dailyRate: 3100,
        createdByUserId: founder.id,
      },
    }),
  ]);

  await prisma.objectAttendanceFact.createMany({
    data: [
      // Same server-local date construction as attendance writes.
      { employeeId: employee.id, objectId: firstObject.id, operationDate: new Date(2026, 8, 30), dailyRateSnapshot: 2500 },
      { employeeId: employee.id, objectId: firstObject.id, operationDate: new Date(2026, 9, 1), dailyRateSnapshot: 2500, workedHours: 6 },
      { employeeId: employee.id, objectId: secondObject.id, operationDate: new Date(2026, 9, 1), dailyRateSnapshot: 3100 },
      { employeeId: employee.id, objectId: secondObject.id, operationDate: new Date(2026, 9, 31), dailyRateSnapshot: 3100 },
      { employeeId: employee.id, objectId: secondObject.id, operationDate: new Date(2026, 10, 1), dailyRateSnapshot: 3100 },
    ],
  });

  const request = (cookie: string, query: string) =>
    fetch(`${baseUrl}/api/v1/employees/${employee.id}/attendance?${query}`, {
      headers: { Cookie: cookie },
    });

  const response = await request(hrCookie, 'year=2026&month=10');
  assert.equal(response.status, 200, await response.clone().text());
  const calendar = (await response.json()) as AttendanceResponse;
  assert.equal(calendar.year, 2026);
  assert.equal(calendar.month, 10);
  assert.deepEqual(calendar.days.map((day) => day.date), ['2026-10-01', '2026-10-31']);
  assert.equal(calendar.days[0]?.objects.length, 2);
  assert.ok(
    calendar.days[0]?.objects.some((object) => object.workedHours === 6),
    'the recorded hours should be present on the matching day regardless of object ordering',
  );

  const serialized = JSON.stringify(calendar);
  assert.ok(!serialized.includes('dailyRate'), 'money snapshots must not leak');
  assert.ok(!serialized.includes('ratePolicy'), 'rate policies must not leak');

  const managerResponse = await request(managerCookie, 'year=2026&month=10');
  assert.equal(managerResponse.status, 200);

  assert.equal((await request(hrCookie, 'year=2026&month=13')).status, 400);
  const missing = await fetch(`${baseUrl}/api/v1/employees/${randomUUID()}/attendance?year=2026&month=10`, {
    headers: { Cookie: hrCookie },
  });
  assert.equal(missing.status, 404);
});
