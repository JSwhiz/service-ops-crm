import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface OrderResponse {
  id: string;
  status: string;
  workCycle: number;
  completedAt: string | null;
  completedBy: { id: string } | null;
  capabilities: {
    canComplete: boolean;
    canReopen: boolean;
  };
}

interface CompletionResponse {
  id: string;
  oneTimeOrderId: string;
  workCycle: number;
  completionComment: string | null;
  status: string;
  clientRequestId: string | null;
}

test('one-time order completion cycles are access-safe, idempotent and serialized', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `completion-cycle-${Date.now()}`;
  const createdOrderIds: string[] = [];
  const [managerOne, managerTwo] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } }),
  ]);

  t.after(async () => {
    await prisma.auditEvent.deleteMany({
      where: {
        entityType: 'one_time_order',
        entityId: { in: createdOrderIds },
      },
    });
    await prisma.oneTimeOrder.deleteMany({
      where: { id: { in: createdOrderIds } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  const [founderCookie, managerOneCookie, managerTwoCookie] = await Promise.all([
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
      login: 'manager2',
      password: 'manager123',
    }),
  ]);
  const jsonPost = (url: string, cookie: string, body: unknown = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const createOrder = async (managerUserIds: string[]) => {
    const response = await jsonPost(
      `${baseUrl}/api/v1/one-time-orders`,
      founderCookie,
      {
        title: `${marker}-${createdOrderIds.length + 1}`,
        executionAddress: 'Москва, тестовый адрес завершения',
        status: 'in_progress',
        contactName: 'Тестовый заказчик',
        agreedSum: 10000,
        managerUserIds,
      },
    );
    assert.equal(response.status, 201);
    const order = (await response.json()) as OrderResponse;
    createdOrderIds.push(order.id);
    assert.equal(order.workCycle, 1);
    assert.equal(order.capabilities.canComplete, true);
    return order;
  };
  const complete = (
    orderId: string,
    cookie: string,
    clientRequestId: string,
    completionComment = 'Работы завершены',
    workCycle = 1,
  ) =>
    jsonPost(`${baseUrl}/api/v1/one-time-orders/${orderId}/complete`, cookie, {
      clientRequestId,
      completionComment,
      workCycle,
    });

  const invalidCreate = await jsonPost(
    `${baseUrl}/api/v1/one-time-orders`,
    founderCookie,
    {
      title: `${marker}-invalid-completed`,
      executionAddress: 'Москва, закрытый заказ',
      status: 'completed',
      contactName: 'Тестовый заказчик',
    },
  );
  assert.equal(invalidCreate.status, 409);

  const privateOrder = await createOrder([managerOne.id]);
  const denied = await complete(
    privateOrder.id,
    managerTwoCookie,
    `${marker}-denied`,
  );
  assert.equal(denied.status, 404);

  const legacyComplete = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${privateOrder.id}/status`,
    {
      method: 'PATCH',
      headers: {
        Cookie: managerOneCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'completed' }),
    },
  );
  assert.equal(legacyComplete.status, 409);

  const multiManagerOrder = await createOrder([managerOne.id, managerTwo.id]);
  const firstRequestId = `${marker}-cycle-1`;
  const firstComplete = await complete(
    multiManagerOrder.id,
    managerTwoCookie,
    firstRequestId,
  );
  assert.equal(firstComplete.status, 201);
  const firstCompletion = (await firstComplete.json()) as CompletionResponse;
  assert.equal(firstCompletion.workCycle, 1);
  assert.equal(firstCompletion.status, 'active');

  const repeatedComplete = await complete(
    multiManagerOrder.id,
    managerTwoCookie,
    firstRequestId,
  );
  assert.equal(repeatedComplete.status, 201);
  assert.equal(
    ((await repeatedComplete.json()) as CompletionResponse).id,
    firstCompletion.id,
  );
  assert.equal(
    await prisma.oneTimeOrderCompletion.count({
      where: { oneTimeOrderId: multiManagerOrder.id },
    }),
    1,
  );

  const changedRetry = await complete(
    multiManagerOrder.id,
    managerTwoCookie,
    firstRequestId,
    'Другой payload',
  );
  assert.equal(changedRetry.status, 409);

  const legacyReopen = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${multiManagerOrder.id}/status`,
    {
      method: 'PATCH',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status: 'in_progress' }),
    },
  );
  assert.equal(legacyReopen.status, 409);

  const reopen = await jsonPost(
    `${baseUrl}/api/v1/one-time-orders/${multiManagerOrder.id}/reopen`,
    managerOneCookie,
  );
  assert.equal(reopen.status, 201);
  const reopenedOrder = (await reopen.json()) as OrderResponse;
  assert.equal(reopenedOrder.status, 'in_progress');
  assert.equal(reopenedOrder.workCycle, 2);
  assert.equal(reopenedOrder.completedAt, null);
  assert.equal(reopenedOrder.completedBy, null);
  assert.equal(reopenedOrder.capabilities.canComplete, true);

  const repeatedReopen = await jsonPost(
    `${baseUrl}/api/v1/one-time-orders/${multiManagerOrder.id}/reopen`,
    managerOneCookie,
  );
  assert.equal(repeatedReopen.status, 409);

  const secondComplete = await complete(
    multiManagerOrder.id,
    managerOneCookie,
    `${marker}-cycle-2`,
    'Повторный выезд завершён',
    2,
  );
  assert.equal(secondComplete.status, 201);
  assert.equal(
    ((await secondComplete.json()) as CompletionResponse).workCycle,
    2,
  );

  const historyResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${multiManagerOrder.id}/completions`,
    { headers: { Cookie: managerOneCookie } },
  );
  assert.equal(historyResponse.status, 200);
  const history = (await historyResponse.json()) as CompletionResponse[];
  assert.deepEqual(
    history.map((item) => [item.workCycle, item.status]),
    [
      [2, 'active'],
      [1, 'superseded'],
    ],
  );

  const completeVsReopen = await Promise.all([
    complete(
      multiManagerOrder.id,
      managerOneCookie,
      `${marker}-stale-cycle-2`,
      'Запоздавшее завершение',
      2,
    ),
    jsonPost(
      `${baseUrl}/api/v1/one-time-orders/${multiManagerOrder.id}/reopen`,
      managerTwoCookie,
    ),
  ]);
  assert.deepEqual(
    completeVsReopen.map((response) => response.status).sort((a, b) => a - b),
    [201, 409],
  );
  const afterCompleteVsReopen = await prisma.oneTimeOrder.findUniqueOrThrow({
    where: { id: multiManagerOrder.id },
  });
  assert.equal(afterCompleteVsReopen.status, 'in_progress');
  assert.equal(afterCompleteVsReopen.workCycle, 3);
  assert.equal(
    await prisma.oneTimeOrderCompletion.count({
      where: { oneTimeOrderId: multiManagerOrder.id },
    }),
    2,
  );

  const raceOrder = await createOrder([managerOne.id]);
  const raceResponses = await Promise.all([
    complete(raceOrder.id, managerOneCookie, `${marker}-race-a`),
    complete(raceOrder.id, managerOneCookie, `${marker}-race-b`),
  ]);
  assert.deepEqual(
    raceResponses.map((response) => response.status).sort((a, b) => a - b),
    [201, 409],
  );
  assert.equal(
    await prisma.oneTimeOrderCompletion.count({
      where: { oneTimeOrderId: raceOrder.id },
    }),
    1,
  );

  const reopenResponses = await Promise.all([
    jsonPost(
      `${baseUrl}/api/v1/one-time-orders/${raceOrder.id}/reopen`,
      managerOneCookie,
    ),
    jsonPost(
      `${baseUrl}/api/v1/one-time-orders/${raceOrder.id}/reopen`,
      founderCookie,
    ),
  ]);
  assert.deepEqual(
    reopenResponses.map((response) => response.status).sort((a, b) => a - b),
    [201, 409],
  );
  const persistedRaceOrder = await prisma.oneTimeOrder.findUniqueOrThrow({
    where: { id: raceOrder.id },
  });
  assert.equal(persistedRaceOrder.workCycle, 2);
  assert.equal(persistedRaceOrder.status, 'in_progress');
  assert.equal(
    await prisma.auditEvent.count({
      where: {
        entityType: 'one_time_order',
        entityId: raceOrder.id,
        action: 'one_time_order.reopened',
      },
    }),
    1,
  );
});
