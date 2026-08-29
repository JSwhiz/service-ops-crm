import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface OrderDateResponse {
  id: string;
  executionDate: string | null;
  executionStartDate: string | null;
  executionEndDate: string | null;
  durationDays: number | null;
}

test('one-time order execution dates support empty, single and multi-day ranges', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = randomUUID().slice(0, 8);
  const orderIds: string[] = [];
  const founderCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'founder',
    password: 'founder123',
  });

  t.after(async () => {
    await prisma.auditEvent.deleteMany({
      where: { entityType: 'one_time_order', entityId: { in: orderIds } },
    });
    await prisma.oneTimeOrder.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.chatMessage.deleteMany({
      where: { text: { contains: marker } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  const createOrder = async (dates: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl}/api/v1/one-time-orders`, {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: `Date range ${marker}`,
        executionAddress: 'Москва, тестовый адрес',
        contactName: 'Тестовый контакт',
        plannedPaymentMethod: 'cash',
        ...dates,
      }),
    });
    const payload = (await response.json()) as Partial<OrderDateResponse>;

    if (payload.id) {
      orderIds.push(payload.id);
    }

    return { response, payload };
  };

  const noDate = await createOrder({});
  assert.equal(noDate.response.status, 201);
  assert.deepEqual(
    {
      start: noDate.payload.executionStartDate,
      end: noDate.payload.executionEndDate,
      duration: noDate.payload.durationDays,
    },
    { start: null, end: null, duration: null },
  );

  const singleDay = await createOrder({ executionStartDate: '2026-07-15' });
  assert.equal(singleDay.response.status, 201);
  assert.equal(singleDay.payload.executionDate, '2026-07-15');
  assert.equal(singleDay.payload.executionStartDate, '2026-07-15');
  assert.equal(singleDay.payload.executionEndDate, '2026-07-15');
  assert.equal(singleDay.payload.durationDays, 1);

  const multiDay = await createOrder({
    executionStartDate: '2026-07-15',
    executionEndDate: '2026-07-18',
  });
  assert.equal(multiDay.response.status, 201);
  assert.equal(multiDay.payload.executionStartDate, '2026-07-15');
  assert.equal(multiDay.payload.executionEndDate, '2026-07-18');
  assert.equal(multiDay.payload.durationDays, 4);

  const patchOrder = async (payload: Record<string, unknown>) => {
    const response = await fetch(
      `${baseUrl}/api/v1/one-time-orders/${multiDay.payload.id}`,
      {
        method: 'PATCH',
        headers: {
          Cookie: founderCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );

    return {
      response,
      payload: (await response.json()) as OrderDateResponse,
    };
  };

  const endOnly = await patchOrder({ executionEndDate: '2026-07-20' });
  assert.equal(endOnly.response.status, 200);
  assert.equal(endOnly.payload.executionStartDate, '2026-07-15');
  assert.equal(endOnly.payload.executionEndDate, '2026-07-20');

  const startOnly = await patchOrder({ executionStartDate: '2026-07-16' });
  assert.equal(startOnly.response.status, 200);
  assert.equal(startOnly.payload.executionStartDate, '2026-07-16');
  assert.equal(startOnly.payload.executionEndDate, '2026-07-20');

  const clearEnd = await patchOrder({ executionEndDate: null });
  assert.equal(clearEnd.response.status, 200);
  assert.equal(clearEnd.payload.executionStartDate, '2026-07-16');
  assert.equal(clearEnd.payload.executionEndDate, '2026-07-16');

  const legacyPatch = await patchOrder({ executionDate: '2026-08-01' });
  assert.equal(legacyPatch.response.status, 200);
  assert.equal(legacyPatch.payload.executionStartDate, '2026-08-01');
  assert.equal(legacyPatch.payload.executionEndDate, '2026-08-01');

  const clearRange = await patchOrder({ executionStartDate: null });
  assert.equal(clearRange.response.status, 200);
  assert.equal(clearRange.payload.executionStartDate, null);
  assert.equal(clearRange.payload.executionEndDate, null);

  const legacyBoundary = await createOrder({ executionDate: '2026-12-31' });
  assert.equal(legacyBoundary.response.status, 201);
  assert.equal(legacyBoundary.payload.executionDate, '2026-12-31');
  assert.equal(legacyBoundary.payload.executionStartDate, '2026-12-31');
  assert.equal(legacyBoundary.payload.executionEndDate, '2026-12-31');

  const endWithoutStart = await createOrder({
    executionEndDate: '2026-07-18',
  });
  assert.equal(endWithoutStart.response.status, 400);

  const reversed = await createOrder({
    executionStartDate: '2026-07-18',
    executionEndDate: '2026-07-15',
  });
  assert.equal(reversed.response.status, 400);

  const tooLong = await createOrder({
    executionStartDate: '2026-01-01',
    executionEndDate: '2027-01-02',
  });
  assert.equal(tooLong.response.status, 400);
});
