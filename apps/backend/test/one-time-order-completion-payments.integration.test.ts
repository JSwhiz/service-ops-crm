import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface PaymentInput {
  recipientUserId?: string | null;
  amount: number;
  paymentMethod: string;
  paymentDestination: string;
  zeroReason?: string;
  comment?: string;
  differenceReason?: string;
  receivedAt?: string;
}

interface CompletionResponse {
  id: string;
  workCycle: number;
  totalAmount: number;
  payments: Array<{
    id: string;
    recipient: { id: string } | null;
    amount: number;
    paymentMethod: string;
    paymentDestination: string;
    status: string;
  }>;
}

test('one-time order completion validates and stores actual payment rows', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `completion-payment-${Date.now()}`;
  const createdOrderIds: string[] = [];
  const createdUserIds: string[] = [];
  const templateManager = await prisma.user.findUniqueOrThrow({
    where: { login: 'manager1' },
  });
  const managerRole = await prisma.role.findUniqueOrThrow({
    where: { code: 'manager' },
  });
  const createdManagers = await Promise.all(
    [1, 2].map((index) =>
      prisma.user.create({
        data: {
          login: `${marker}-manager-${index}`,
          fullName: `Тестовый менеджер оплат ${index}`,
          passwordHash: templateManager.passwordHash,
          isActive: true,
          roles: { create: { roleId: managerRole.id } },
        },
      }),
    ),
  );
  const managerOne = createdManagers[0]!;
  const managerTwo = createdManagers[1]!;
  createdUserIds.push(managerOne.id, managerTwo.id);

  t.after(async () => {
    const fundingIds = (
      await prisma.accountabilityFunding.findMany({
        where: { accountabilityAccount: { userId: { in: createdUserIds } } },
        select: { id: true },
      })
    ).map((funding) => funding.id);
    await prisma.auditEvent.deleteMany({
      where: {
        OR: [
          {
            entityType: 'one_time_order',
            entityId: { in: createdOrderIds },
          },
          {
            entityType: 'accountability_funding',
            entityId: { in: fundingIds },
          },
        ],
      },
    });
    await prisma.accountabilityFunding.deleteMany({
      where: { accountabilityAccount: { userId: { in: createdUserIds } } },
    });
    await prisma.oneTimeOrder.deleteMany({
      where: { id: { in: createdOrderIds } },
    });
    await prisma.accountabilityAccount.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: createdUserIds } },
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
      login: managerOne.login,
      password: 'manager123',
    }),
  ]);
  const postJson = (url: string, cookie: string, body: unknown = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const createOrder = async (
    managerUserIds: string[],
    agreedSum?: number,
  ): Promise<string> => {
    const response = await postJson(
      `${baseUrl}/api/v1/one-time-orders`,
      founderCookie,
      {
        title: `${marker}-${createdOrderIds.length + 1}`,
        executionAddress: 'Москва, адрес оплаты',
        status: 'in_progress',
        contactName: 'Тестовый заказчик',
        ...(agreedSum === undefined ? {} : { agreedSum }),
        managerUserIds,
      },
    );
    assert.equal(response.status, 201);
    const order = (await response.json()) as { id: string };
    createdOrderIds.push(order.id);
    return order.id;
  };
  const complete = (
    orderId: string,
    workCycle: number,
    clientRequestId: string,
    payments: PaymentInput[],
    cookie = managerCookie,
  ) =>
    postJson(
      `${baseUrl}/api/v1/one-time-orders/${orderId}/complete`,
      cookie,
      {
        workCycle,
        clientRequestId,
        completionComment: 'Фактическая оплата зафиксирована',
        payments,
      },
    );

  const orderId = await createOrder([managerOne.id], 35000);
  const invalidRecipient = await complete(
    orderId,
    1,
    `${marker}-invalid-recipient`,
    [
      {
        recipientUserId: managerTwo.id,
        amount: 35000,
        paymentMethod: 'cash',
        paymentDestination: 'manager_accountability',
      },
    ],
  );
  assert.equal(invalidRecipient.status, 400);

  const invalidMethodDestination = await complete(
    orderId,
    1,
    `${marker}-invalid-method`,
    [
      {
        amount: 35000,
        paymentMethod: 'cash',
        paymentDestination: 'organization',
      },
    ],
  );
  assert.equal(invalidMethodDestination.status, 400);

  const zeroWithoutReason = await complete(
    orderId,
    1,
    `${marker}-zero-without-reason`,
    [
      {
        recipientUserId: managerOne.id,
        amount: 0,
        paymentMethod: 'cash',
        paymentDestination: 'manager_accountability',
        differenceReason: 'Ожидается последующая оплата',
      },
    ],
  );
  assert.equal(zeroWithoutReason.status, 400);
  assert.equal(
    await prisma.oneTimeOrderCompletion.count({ where: { oneTimeOrderId: orderId } }),
    0,
  );

  const receivedAt = '2045-06-10T12:30:00.000Z';
  const validPayments: PaymentInput[] = [
    {
      recipientUserId: managerOne.id,
      amount: 20000,
      paymentMethod: 'cash',
      paymentDestination: 'manager_accountability',
      receivedAt,
    },
    {
      amount: 15000,
      paymentMethod: 'organization_transfer',
      paymentDestination: 'organization',
      receivedAt,
    },
  ];
  const requestId = `${marker}-valid-cycle-1`;
  const completed = await complete(orderId, 1, requestId, validPayments);
  assert.equal(completed.status, 201);
  const completion = (await completed.json()) as CompletionResponse;
  assert.equal(completion.totalAmount, 35000);
  assert.equal(completion.payments.length, 2);
  assert.equal(completion.payments[0]?.recipient?.id, managerOne.id);
  assert.equal(completion.payments[1]?.recipient, null);

  const repeated = await complete(orderId, 1, requestId, validPayments);
  assert.equal(repeated.status, 201);
  assert.equal(((await repeated.json()) as CompletionResponse).id, completion.id);
  assert.equal(
    await prisma.oneTimeOrderCompletionPayment.count({
      where: { oneTimeOrderId: orderId },
    }),
    2,
  );

  const changedRetry = await complete(orderId, 1, requestId, [
    {
      recipientUserId: managerOne.id,
      amount: 35000,
      paymentMethod: 'cash',
      paymentDestination: 'manager_accountability',
    },
  ]);
  assert.equal(changedRetry.status, 409);

  const reopened = await postJson(
    `${baseUrl}/api/v1/one-time-orders/${orderId}/reopen`,
    managerCookie,
  );
  assert.equal(reopened.status, 201);
  const mismatchWithoutReason = await complete(
    orderId,
    2,
    `${marker}-mismatch-without-reason`,
    [
      {
        recipientUserId: managerOne.id,
        amount: 5000,
        paymentMethod: 'personal_card_transfer',
        paymentDestination: 'manager_accountability',
      },
    ],
  );
  assert.equal(mismatchWithoutReason.status, 400);

  const mismatchWithReason = await complete(
    orderId,
    2,
    `${marker}-mismatch-with-reason`,
    [
      {
        recipientUserId: managerOne.id,
        amount: 5000,
        paymentMethod: 'personal_card_transfer',
        paymentDestination: 'manager_accountability',
        differenceReason: 'Дополнительный повторный выезд',
      },
    ],
  );
  assert.equal(mismatchWithReason.status, 201);
  assert.equal(
    ((await mismatchWithReason.json()) as CompletionResponse).totalAmount,
    5000,
  );
  const cumulative = await prisma.oneTimeOrderCompletionPayment.aggregate({
    where: { oneTimeOrderId: orderId, status: 'active' },
    _sum: { amount: true },
  });
  assert.equal(cumulative._sum.amount?.toNumber(), 40000);

  const noAgreementOrderId = await createOrder([managerOne.id]);
  const noAgreement = await complete(
    noAgreementOrderId,
    1,
    `${marker}-no-agreement`,
    [
      {
        recipientUserId: managerOne.id,
        amount: 123.45,
        paymentMethod: 'personal_card_transfer',
        paymentDestination: 'manager_accountability',
      },
    ],
  );
  assert.equal(noAgreement.status, 201);

  const zeroOrderId = await createOrder([managerOne.id], 0);
  const zeroPayment = await complete(
    zeroOrderId,
    1,
    `${marker}-zero-valid`,
    [
      {
        recipientUserId: managerOne.id,
        amount: 0,
        paymentMethod: 'cash',
        paymentDestination: 'manager_accountability',
        zeroReason: 'payment_later',
      },
    ],
  );
  assert.equal(zeroPayment.status, 201);

  const otherOrderId = await createOrder([managerOne.id], 10);
  const otherWithoutComment = await complete(
    otherOrderId,
    1,
    `${marker}-other-without-comment`,
    [
      {
        amount: 10,
        paymentMethod: 'other',
        paymentDestination: 'organization',
      },
    ],
  );
  assert.equal(otherWithoutComment.status, 400);
  const otherWithComment = await complete(
    otherOrderId,
    1,
    `${marker}-other-with-comment`,
    [
      {
        amount: 10,
        paymentMethod: 'other',
        paymentDestination: 'organization',
        comment: 'Другой согласованный способ',
      },
    ],
  );
  assert.equal(otherWithComment.status, 201);

  const inactiveAssignmentOrderId = await createOrder([managerOne.id], 50);
  await prisma.oneTimeOrderAssignment.updateMany({
    where: {
      oneTimeOrderId: inactiveAssignmentOrderId,
      userId: managerOne.id,
      assignmentRoleCode: 'one_time_manager',
    },
    data: { isActive: false },
  });
  const inactiveRecipient = await complete(
    inactiveAssignmentOrderId,
    1,
    `${marker}-inactive-recipient`,
    [
      {
        recipientUserId: managerOne.id,
        amount: 50,
        paymentMethod: 'cash',
        paymentDestination: 'manager_accountability',
      },
    ],
    founderCookie,
  );
  assert.equal(inactiveRecipient.status, 400);
});
