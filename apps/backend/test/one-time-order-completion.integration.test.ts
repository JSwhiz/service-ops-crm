import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

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
  completedAt: string | null;
  completedBy: { id: string } | null;
  completionComment: string | null;
  completionSource: 'native' | 'legacy_unknown';
  status: string;
  clientRequestId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
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
  const founder = await prisma.user.findUniqueOrThrow({
    where: { login: 'founder' },
  });

  t.after(async () => {
    if (usesIsolatedIntegrationDatabase()) {
      await app.close();
      await prisma.$disconnect();
      return;
    }
    await prisma.auditEvent.deleteMany({
      where: {
        entityType: 'one_time_order',
        entityId: { in: createdOrderIds },
      },
    });
    await prisma.accountabilityFunding.deleteMany({
      where: { oneTimeOrderId: { in: createdOrderIds } },
    });
    await prisma.oneTimeOrderCompletionPayment.deleteMany({
      where: { oneTimeOrderId: { in: createdOrderIds } },
    });
    await prisma.oneTimeOrderCompletion.deleteMany({
      where: { oneTimeOrderId: { in: createdOrderIds } },
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
      payments:
        workCycle === 1
          ? [
              {
                amount: 10000,
                paymentMethod: 'organization_transfer',
                paymentDestination: 'organization',
              },
            ]
          : [
              {
                amount: 0,
                paymentMethod: 'organization_transfer',
                paymentDestination: 'organization',
                zeroReason: 'payment_later',
              },
            ],
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

  const legacyWithoutHistory = await prisma.oneTimeOrder.create({
    data: {
      title: `${marker}-legacy-without-history`,
      executionAddress: 'Москва, исторический заказ',
      contactName: 'Исторический заказчик',
      status: 'completed',
      workCycle: 1,
      createdByUserId: founder.id,
    },
  });
  createdOrderIds.push(legacyWithoutHistory.id);
  const legacyOrderResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${legacyWithoutHistory.id}`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(legacyOrderResponse.status, 200);
  const legacyOrder = (await legacyOrderResponse.json()) as OrderResponse;
  assert.equal(legacyOrder.status, 'completed');
  assert.equal(legacyOrder.completedAt, null);
  assert.equal(legacyOrder.completedBy, null);
  const emptyLegacyHistoryResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${legacyWithoutHistory.id}/completions`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(emptyLegacyHistoryResponse.status, 200);
  assert.deepEqual(await emptyLegacyHistoryResponse.json(), []);

  const legacyUnknownOrder = await prisma.oneTimeOrder.create({
    data: {
      title: `${marker}-legacy-unknown`,
      executionAddress: 'Москва, сохраненная историческая запись',
      contactName: 'Исторический заказчик',
      status: 'completed',
      workCycle: 1,
      createdByUserId: founder.id,
    },
  });
  createdOrderIds.push(legacyUnknownOrder.id);
  const technicalDate = new Date('2025-01-15T12:00:00.000Z');
  await prisma.oneTimeOrderCompletion.create({
    data: {
      oneTimeOrderId: legacyUnknownOrder.id,
      workCycle: 1,
      completedAt: technicalDate,
      completedByUserId: founder.id,
      completionComment: 'Legacy completion backfill',
      completionSource: 'legacy_unknown',
      status: 'active',
    },
  });
  const legacyUnknownHistoryResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${legacyUnknownOrder.id}/completions`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(legacyUnknownHistoryResponse.status, 200);
  const legacyUnknownHistory =
    (await legacyUnknownHistoryResponse.json()) as CompletionResponse[];
  assert.equal(legacyUnknownHistory.length, 1);
  assert.equal(legacyUnknownHistory[0]!.completionSource, 'legacy_unknown');
  assert.equal(legacyUnknownHistory[0]!.completedAt, null);
  assert.equal(legacyUnknownHistory[0]!.completedBy, null);
  assert.equal(legacyUnknownHistory[0]!.completionComment, null);
  assert.equal(legacyUnknownHistory[0]!.createdAt, null);
  assert.equal(legacyUnknownHistory[0]!.updatedAt, null);

  const privateOrder = await createOrder([managerOne.id]);
  const invalidRequestId = await complete(
    privateOrder.id,
    managerOneCookie,
    'legacy-request-id',
  );
  assert.equal(invalidRequestId.status, 400);
  const missingRequestId = await jsonPost(
    `${baseUrl}/api/v1/one-time-orders/${privateOrder.id}/complete`,
    managerOneCookie,
    {
      workCycle: 1,
      payments: [
        {
          amount: 10000,
          paymentMethod: 'organization_transfer',
          paymentDestination: 'organization',
        },
      ],
    },
  );
  assert.equal(missingRequestId.status, 400);
  const denied = await complete(
    privateOrder.id,
    managerTwoCookie,
    crypto.randomUUID(),
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
  const firstRequestId = crypto.randomUUID();
  const firstComplete = await complete(
    multiManagerOrder.id,
    managerTwoCookie,
    firstRequestId,
  );
  assert.equal(firstComplete.status, 201);
  const firstCompletion = (await firstComplete.json()) as CompletionResponse;
  assert.equal(firstCompletion.workCycle, 1);
  assert.equal(firstCompletion.completionSource, 'native');
  assert.ok(firstCompletion.completedAt);
  assert.ok(firstCompletion.completedBy);
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
    crypto.randomUUID(),
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
      crypto.randomUUID(),
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
    complete(raceOrder.id, managerOneCookie, crypto.randomUUID()),
    complete(raceOrder.id, managerOneCookie, crypto.randomUUID()),
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

  const doubleSubmitOrder = await createOrder([managerOne.id]);
  const doubleSubmitRequestId = crypto.randomUUID();
  const doubleSubmitResponses = await Promise.all([
    complete(
      doubleSubmitOrder.id,
      managerOneCookie,
      doubleSubmitRequestId,
    ),
    complete(
      doubleSubmitOrder.id,
      managerOneCookie,
      doubleSubmitRequestId,
    ),
  ]);
  assert.deepEqual(
    doubleSubmitResponses.map((response) => response.status),
    [201, 201],
  );
  const doubleSubmitCompletionIds = await Promise.all(
    doubleSubmitResponses.map(async (response) =>
      ((await response.json()) as CompletionResponse).id,
    ),
  );
  assert.equal(new Set(doubleSubmitCompletionIds).size, 1);
  assert.equal(
    await prisma.oneTimeOrderCompletion.count({
      where: { oneTimeOrderId: doubleSubmitOrder.id },
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
