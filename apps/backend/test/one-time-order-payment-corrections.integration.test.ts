import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface CompletionResponse {
  id: string;
  visibleTotalAmount: number;
  payments: Array<{
    id: string;
    amount: number;
    status: string;
    reversalOfPaymentId: string | null;
    reversedByPaymentId: string | null;
    correctedFromPaymentId: string | null;
    correctedByPaymentId: string | null;
  }>;
}

test('one-time order payment corrections preserve an auditable ledger chain', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `payment-correction-${Date.now()}`;
  const createdOrderIds: string[] = [];
  const templateManager = await prisma.user.findUniqueOrThrow({
    where: { login: 'manager1' },
  });
  const managerRole = await prisma.role.findUniqueOrThrow({
    where: { code: 'manager' },
  });
  const manager = await prisma.user.create({
    data: {
      login: marker,
      fullName: 'Тестовый менеджер корректировок',
      passwordHash: templateManager.passwordHash,
      isActive: true,
      roles: { create: { roleId: managerRole.id } },
    },
  });

  t.after(async () => {
    const fundingIds = (
      await prisma.accountabilityFunding.findMany({
        where: { accountabilityAccount: { userId: manager.id } },
        select: { id: true },
      })
    ).map((funding) => funding.id);
    await prisma.auditEvent.deleteMany({
      where: {
        OR: [
          { entityType: 'one_time_order', entityId: { in: createdOrderIds } },
          {
            entityType: 'accountability_funding',
            entityId: { in: fundingIds },
          },
        ],
      },
    });
    await prisma.accountabilityExpense.deleteMany({
      where: { accountabilityAccount: { userId: manager.id } },
    });
    await prisma.accountabilityFunding.deleteMany({
      where: { accountabilityAccount: { userId: manager.id } },
    });
    await prisma.oneTimeOrder.deleteMany({
      where: { id: { in: createdOrderIds } },
    });
    await prisma.accountabilityAccount.deleteMany({
      where: { userId: manager.id },
    });
    await prisma.userRole.deleteMany({ where: { userId: manager.id } });
    await prisma.user.delete({ where: { id: manager.id } });
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
      login: manager.login,
      password: 'manager123',
    }),
  ]);
  const postJson = (url: string, cookie: string, body: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const createCompletedOrder = async (params: {
    amount: number;
    paymentMethod: string;
    paymentDestination: string;
    recipientUserId?: string;
  }) => {
    const createResponse = await postJson(
      `${baseUrl}/api/v1/one-time-orders`,
      founderCookie,
      {
        title: `${marker}-${createdOrderIds.length + 1}`,
        executionAddress: 'Москва, адрес корректировки оплаты',
        status: 'in_progress',
        contactName: 'Тестовый заказчик',
        agreedSum: params.amount,
        managerUserIds: [manager.id],
      },
    );
    assert.equal(createResponse.status, 201);
    const order = (await createResponse.json()) as { id: string };
    createdOrderIds.push(order.id);

    const completeResponse = await postJson(
      `${baseUrl}/api/v1/one-time-orders/${order.id}/complete`,
      founderCookie,
      {
        workCycle: 1,
        clientRequestId: `${marker}-${order.id}`,
        payments: [params],
      },
    );
    assert.equal(completeResponse.status, 201);
    const completion = (await completeResponse.json()) as CompletionResponse;
    return { orderId: order.id, completion, source: completion.payments[0]! };
  };
  const correct = (
    orderId: string,
    paymentId: string,
    body: Record<string, unknown>,
    cookie = founderCookie,
  ) =>
    postJson(
      `${baseUrl}/api/v1/one-time-orders/${orderId}/payments/${paymentId}/correct`,
      cookie,
      body,
    );

  const personal = await createCompletedOrder({
    amount: 35000,
    paymentMethod: 'cash',
    paymentDestination: 'manager_accountability',
    recipientUserId: manager.id,
  });
  const forbidden = await correct(
    personal.orderId,
    personal.source.id,
    {
      correctedAmount: 30000,
      paymentMethod: 'cash',
      paymentDestination: 'manager_accountability',
      recipientUserId: manager.id,
      reason: 'Исправление суммы',
    },
    managerCookie,
  );
  assert.equal(forbidden.status, 403);

  const correctedResponse = await correct(personal.orderId, personal.source.id, {
    correctedAmount: 30000,
    paymentMethod: 'cash',
    paymentDestination: 'manager_accountability',
    recipientUserId: manager.id,
    reason: 'Клиент передал меньшую сумму',
  });
  assert.equal(
    correctedResponse.status,
    201,
    await correctedResponse.clone().text(),
  );
  const corrected = (await correctedResponse.json()) as CompletionResponse;
  assert.equal(corrected.visibleTotalAmount, 30000);
  const source = corrected.payments.find(
    (payment) => payment.id === personal.source.id,
  )!;
  const reversal = corrected.payments.find(
    (payment) => payment.reversalOfPaymentId === personal.source.id,
  )!;
  const replacement = corrected.payments.find(
    (payment) => payment.correctedFromPaymentId === personal.source.id,
  )!;
  assert.equal(source.status, 'reversed');
  assert.equal(source.reversedByPaymentId, reversal.id);
  assert.equal(source.correctedByPaymentId, replacement.id);
  assert.equal(reversal.status, 'reversal');
  assert.equal(replacement.status, 'active');
  assert.equal(replacement.amount, 30000);

  const personalFundings = await prisma.accountabilityFunding.findMany({
    where: { oneTimeOrderId: personal.orderId },
  });
  assert.equal(personalFundings.length, 3);
  const sourceFunding = personalFundings.find(
    (funding) =>
      funding.fundingType === 'one_time_order_receipt' &&
      funding.amount.equals(35000),
  )!;
  const reversalFunding = personalFundings.find(
    (funding) =>
      funding.fundingType === 'one_time_order_receipt_reversal' &&
      funding.entryDirection === 'debit',
  )!;
  const correctedFunding = personalFundings.find(
    (funding) =>
      funding.fundingType === 'one_time_order_receipt' &&
      funding.amount.equals(30000),
  )!;
  assert.ok(sourceFunding);
  assert.ok(reversalFunding);
  assert.ok(correctedFunding);
  assert.equal(sourceFunding.entryDirection, 'credit');
  assert.equal(correctedFunding.entryDirection, 'credit');
  assert.equal(reversalFunding.amount.toNumber(), 35000);
  assert.equal(
    sourceFunding.reversedByFundingId,
    reversalFunding.id,
  );
  assert.equal(reversalFunding.reversalOfFundingId, sourceFunding.id);

  const repeated = await correct(personal.orderId, personal.source.id, {
    correctedAmount: 29000,
    paymentMethod: 'cash',
    paymentDestination: 'manager_accountability',
    recipientUserId: manager.id,
    reason: 'Повторная попытка',
  });
  assert.equal(repeated.status, 409);

  const organization = await createCompletedOrder({
    amount: 100,
    paymentMethod: 'organization_transfer',
    paymentDestination: 'organization',
  });
  const organizationCorrection = await correct(
    organization.orderId,
    organization.source.id,
    {
      correctedAmount: 80,
      paymentMethod: 'organization_transfer',
      paymentDestination: 'organization',
      reason: 'Банковская комиссия',
    },
  );
  assert.equal(organizationCorrection.status, 201);
  assert.equal(
    await prisma.accountabilityFunding.count({
      where: { oneTimeOrderId: organization.orderId },
    }),
    0,
  );

  const zero = await createCompletedOrder({
    amount: 25,
    paymentMethod: 'personal_card_transfer',
    paymentDestination: 'manager_accountability',
    recipientUserId: manager.id,
  });
  const zeroWithoutReason = await correct(zero.orderId, zero.source.id, {
    correctedAmount: 0,
    paymentMethod: 'personal_card_transfer',
    paymentDestination: 'manager_accountability',
    recipientUserId: manager.id,
    reason: 'Оплата не поступила',
  });
  assert.equal(zeroWithoutReason.status, 400);
  const zeroCorrection = await correct(zero.orderId, zero.source.id, {
    correctedAmount: 0,
    paymentMethod: 'personal_card_transfer',
    paymentDestination: 'manager_accountability',
    recipientUserId: manager.id,
    zeroReason: 'payment_later',
    reason: 'Оплата не поступила',
  });
  assert.equal(zeroCorrection.status, 201);
  assert.equal(
    await prisma.accountabilityFunding.count({
      where: {
        oneTimeOrderId: zero.orderId,
        entryDirection: 'credit',
      },
    }),
    1,
  );

  const concurrent = await createCompletedOrder({
    amount: 10,
    paymentMethod: 'cash',
    paymentDestination: 'manager_accountability',
    recipientUserId: manager.id,
  });
  const concurrentResults = await Promise.all([
    correct(concurrent.orderId, concurrent.source.id, {
      correctedAmount: 9,
      paymentMethod: 'cash',
      paymentDestination: 'manager_accountability',
      recipientUserId: manager.id,
      reason: 'Параллельная корректировка 1',
    }),
    correct(concurrent.orderId, concurrent.source.id, {
      correctedAmount: 8,
      paymentMethod: 'cash',
      paymentDestination: 'manager_accountability',
      recipientUserId: manager.id,
      reason: 'Параллельная корректировка 2',
    }),
  ]);
  assert.deepEqual(
    concurrentResults.map((response) => response.status).sort(),
    [201, 409],
  );
  assert.equal(
    await prisma.oneTimeOrderCompletionPayment.count({
      where: { oneTimeOrderId: concurrent.orderId, status: 'active' },
    }),
    1,
  );
  assert.equal(
    await prisma.auditEvent.count({
      where: {
        entityType: 'one_time_order',
        entityId: { in: createdOrderIds },
        action: 'one_time_order.payment_corrected',
      },
    }),
    4,
  );
});
