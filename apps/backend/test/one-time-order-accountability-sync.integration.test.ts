import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('one-time order receipts update accountability atomically and use ledger directions', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `order-accountability-${Date.now()}`;
  const createdOrderIds: string[] = [];
  const createdUserIds: string[] = [];
  const templateManager = await prisma.user.findUniqueOrThrow({
    where: { login: 'manager1' },
  });
  const managerRole = await prisma.role.findUniqueOrThrow({
    where: { code: 'manager' },
  });
  const founder = await prisma.user.findUniqueOrThrow({
    where: { login: 'founder' },
  });
  const recipients = await Promise.all(
    [1, 2].map((index) =>
      prisma.user.create({
        data: {
          login: `${marker}-${index}`,
          fullName: `Тестовый менеджер поступлений ${index}`,
          passwordHash: templateManager.passwordHash,
          isActive: true,
          roles: {
            create: { roleId: managerRole.id },
          },
        },
      }),
    ),
  );
  createdUserIds.push(...recipients.map((user) => user.id));

  t.after(async () => {
    const fundingIds = (
      await prisma.accountabilityFunding.findMany({
        where: {
          accountabilityAccount: { userId: { in: createdUserIds } },
        },
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
    await prisma.accountabilityExpense.deleteMany({
      where: { accountabilityAccount: { userId: { in: createdUserIds } } },
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

  const [founderCookie, recipientCookie] = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: 'founder',
      password: 'founder123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: recipients[0]!.login,
      password: 'manager123',
    }),
  ]);
  const postJson = (url: string, cookie: string, body: unknown = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const createOrder = async (agreedSum: number): Promise<string> => {
    const response = await postJson(
      `${baseUrl}/api/v1/one-time-orders`,
      founderCookie,
      {
        title: `${marker}-${createdOrderIds.length + 1}`,
        executionAddress: 'Москва, адрес синхронизации подотчёта',
        status: 'in_progress',
        contactName: 'Тестовый заказчик',
        agreedSum,
        managerUserIds: recipients.map((user) => user.id),
      },
    );
    assert.equal(response.status, 201);
    const order = (await response.json()) as { id: string };
    createdOrderIds.push(order.id);
    return order.id;
  };

  const existingAccount = await prisma.accountabilityAccount.create({
    data: { userId: recipients[0]!.id, status: 'active' },
  });
  const orderId = await createOrder(175);
  const completePayload = {
    workCycle: 1,
    clientRequestId: `${marker}-complete`,
    completionComment: 'Оплата получена несколькими способами',
    payments: [
      {
        recipientUserId: recipients[0]!.id,
        amount: 100,
        paymentMethod: 'cash',
        paymentDestination: 'manager_accountability',
      },
      {
        recipientUserId: recipients[1]!.id,
        amount: 50,
        paymentMethod: 'personal_card_transfer',
        paymentDestination: 'manager_accountability',
      },
      {
        amount: 25,
        paymentMethod: 'organization_transfer',
        paymentDestination: 'organization',
      },
      {
        recipientUserId: recipients[0]!.id,
        amount: 0,
        paymentMethod: 'cash',
        paymentDestination: 'manager_accountability',
        zeroReason: 'payment_later',
      },
    ],
  };
  const completed = await postJson(
    `${baseUrl}/api/v1/one-time-orders/${orderId}/complete`,
    recipientCookie,
    completePayload,
  );
  assert.equal(completed.status, 201);
  const completion = (await completed.json()) as {
    id: string;
    payments: Array<{ id: string }>;
  };

  const accounts = await prisma.accountabilityAccount.findMany({
    where: { userId: { in: createdUserIds } },
  });
  assert.equal(accounts.length, 2);
  assert.equal(
    accounts.find((account) => account.userId === recipients[0]!.id)?.id,
    existingAccount.id,
  );
  const receiptFundings = await prisma.accountabilityFunding.findMany({
    where: { oneTimeOrderId: orderId },
    orderBy: { amount: 'desc' },
  });
  assert.equal(receiptFundings.length, 2);
  assert.deepEqual(
    receiptFundings.map((funding) => funding.amount.toNumber()),
    [100, 50],
  );
  assert.ok(
    receiptFundings.every(
      (funding) =>
        funding.fundingType === 'one_time_order_receipt' &&
        funding.entryDirection === 'credit' &&
        funding.oneTimeOrderCompletionId === completion.id &&
        funding.oneTimeOrderPaymentId !== null,
    ),
  );
  assert.equal(
    new Set(receiptFundings.map((funding) => funding.oneTimeOrderPaymentId)).size,
    2,
  );

  const repeated = await postJson(
    `${baseUrl}/api/v1/one-time-orders/${orderId}/complete`,
    recipientCookie,
    completePayload,
  );
  assert.equal(repeated.status, 201);
  assert.equal(
    await prisma.accountabilityFunding.count({
      where: { oneTimeOrderId: orderId },
    }),
    2,
  );

  const account = await prisma.accountabilityAccount.findUniqueOrThrow({
    where: { userId: recipients[0]!.id },
  });
  await prisma.accountabilityExpense.createMany({
    data: [
      { accountabilityAccountId: account.id, amount: 10, description: 'Черновик', status: 'draft', createdByUserId: recipients[0]!.id },
      { accountabilityAccountId: account.id, amount: 20, description: 'На проверке', status: 'submitted', createdByUserId: recipients[0]!.id },
      { accountabilityAccountId: account.id, amount: 30, description: 'Подтверждено', status: 'approved', createdByUserId: recipients[0]!.id },
      { accountabilityAccountId: account.id, amount: 5, description: 'Сверено', status: 'reconciled', createdByUserId: recipients[0]!.id },
      { accountabilityAccountId: account.id, amount: 7, description: 'Отклонено', status: 'rejected', createdByUserId: recipients[0]!.id },
    ],
  });
  await prisma.accountabilityFunding.create({
    data: {
      accountabilityAccountId: account.id,
      amount: 8,
      comment: 'Тестовая debit correction',
      issuedByUserId: founder.id,
      recordedByUserId: founder.id,
      fundingType: 'manual_correction',
      entryDirection: 'debit',
    },
  });
  const accountResponse = await fetch(`${baseUrl}/api/v1/accountability/me`, {
    headers: { Cookie: recipientCookie },
  });
  assert.equal(accountResponse.status, 200);
  const accountView = (await accountResponse.json()) as {
    summary: {
      totalCredits: number;
      totalDebits: number;
      currentBalance: number;
      forecastBalance: number;
    };
    fundings: Array<{
      fundingType: string;
      entryDirection: string;
      oneTimeOrderId: string | null;
    }>;
  };
  assert.equal(accountView.summary.totalCredits, 100);
  assert.equal(accountView.summary.totalDebits, 8);
  assert.equal(accountView.summary.currentBalance, 57);
  assert.equal(accountView.summary.forecastBalance, 37);
  assert.ok(
    accountView.fundings.some(
      (funding) =>
        funding.fundingType === 'one_time_order_receipt' &&
        funding.entryDirection === 'credit' &&
        funding.oneTimeOrderId === orderId,
    ),
  );

  const lockedOrderId = await createOrder(30);
  const secondAccount = await prisma.accountabilityAccount.findUniqueOrThrow({
    where: { userId: recipients[1]!.id },
  });
  await prisma.accountabilityAccount.update({
    where: { id: secondAccount.id },
    data: { status: 'closing_requested' },
  });
  const lockedCompletion = await postJson(
    `${baseUrl}/api/v1/one-time-orders/${lockedOrderId}/complete`,
    founderCookie,
    {
      workCycle: 1,
      clientRequestId: `${marker}-locked`,
      payments: [
        {
          recipientUserId: recipients[0]!.id,
          amount: 10,
          paymentMethod: 'cash',
          paymentDestination: 'manager_accountability',
        },
        {
          recipientUserId: recipients[1]!.id,
          amount: 20,
          paymentMethod: 'cash',
          paymentDestination: 'manager_accountability',
        },
      ],
    },
  );
  assert.equal(lockedCompletion.status, 409);
  assert.equal(
    await prisma.oneTimeOrderCompletion.count({
      where: { oneTimeOrderId: lockedOrderId },
    }),
    0,
  );
  assert.equal(
    await prisma.oneTimeOrderCompletionPayment.count({
      where: { oneTimeOrderId: lockedOrderId },
    }),
    0,
  );
  assert.equal(
    await prisma.accountabilityFunding.count({
      where: { oneTimeOrderId: lockedOrderId },
    }),
    0,
  );
  assert.equal(
    (await prisma.oneTimeOrder.findUniqueOrThrow({ where: { id: lockedOrderId } }))
      .status,
    'in_progress',
  );
});
