import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

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
    if (usesIsolatedIntegrationDatabase()) {
      await app.close();
      await prisma.$disconnect();
      return;
    }
    const accounts = await prisma.accountabilityAccount.findMany({
      where: { userId: { in: createdUserIds } },
      select: { id: true },
    });
    const accountIds = accounts.map((account) => account.id);
    const closures = await prisma.accountabilityClosure.findMany({
      where: { accountabilityAccountId: { in: accountIds } },
      select: { id: true },
    });
    const closureIds = closures.map((closure) => closure.id);
    const approvals = await prisma.approvalRequest.findMany({
      where: {
        sourceEntityType: 'accountability_closure',
        sourceEntityId: { in: closureIds },
      },
      select: { id: true },
    });
    const approvalIds = approvals.map((approval) => approval.id);
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
          { entityType: 'accountability_account', entityId: { in: accountIds } },
          {
            entityType: 'accountability_closure',
            entityId: { in: closureIds },
          },
          { entityType: 'approval_request', entityId: { in: approvalIds } },
        ],
      },
    });
    await prisma.approvalRequest.deleteMany({
      where: { id: { in: approvalIds } },
    });
    await prisma.accountabilityClosure.deleteMany({
      where: { id: { in: closureIds } },
    });
    await prisma.accountabilityExpense.deleteMany({
      where: { accountabilityAccount: { userId: { in: createdUserIds } } },
    });
    await prisma.accountabilityFunding.deleteMany({
      where: { accountabilityAccount: { userId: { in: createdUserIds } } },
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

  const [founderCookie, recipientCookie, secondRecipientCookie] =
    await Promise.all([
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
    loginAndGetCookieHeader({
      baseUrl,
      login: recipients[1]!.login,
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
        plannedPaymentMethod: 'cash',
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
    clientRequestId: crypto.randomUUID(),
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

  await prisma.accountabilityAccount.update({
    where: { id: account.id },
    data: { status: 'closed' },
  });
  const closedAccountOrderId = await createOrder(15);
  const closedAccountCompletion = await postJson(
    `${baseUrl}/api/v1/one-time-orders/${closedAccountOrderId}/complete`,
    founderCookie,
    {
      workCycle: 1,
      clientRequestId: crypto.randomUUID(),
      payments: [
        {
          recipientUserId: recipients[0]!.id,
          amount: 15,
          paymentMethod: 'cash',
          paymentDestination: 'manager_accountability',
        },
      ],
    },
  );
  assert.equal(closedAccountCompletion.status, 201);
  assert.equal(
    (
      await prisma.accountabilityAccount.findUniqueOrThrow({
        where: { id: account.id },
      })
    ).status,
    'active',
  );
  assert.equal(
    await prisma.accountabilityFunding.count({
      where: { oneTimeOrderId: closedAccountOrderId },
    }),
    1,
  );

  const closureRequest = await postJson(
    `${baseUrl}/api/v1/accountability/me/closures/request`,
    secondRecipientCookie,
  );
  assert.equal(closureRequest.status, 201);
  const closure = (await closureRequest.json()) as { id: string };
  const closureApproval = await prisma.approvalRequest.findFirstOrThrow({
    where: {
      sourceEntityType: 'accountability_closure',
      sourceEntityId: closure.id,
      status: 'pending',
    },
  });
  const closingAccountOrderId = await createOrder(20);
  const closingAccountCompletion = await postJson(
    `${baseUrl}/api/v1/one-time-orders/${closingAccountOrderId}/complete`,
    founderCookie,
    {
      workCycle: 1,
      clientRequestId: crypto.randomUUID(),
      payments: [
        {
          recipientUserId: recipients[1]!.id,
          amount: 20,
          paymentMethod: 'cash',
          paymentDestination: 'manager_accountability',
        },
      ],
    },
  );
  assert.equal(closingAccountCompletion.status, 201);
  assert.equal(
    (
      await prisma.accountabilityAccount.findUniqueOrThrow({
        where: { userId: recipients[1]!.id },
      })
    ).status,
    'active',
  );
  assert.equal(
    (await prisma.accountabilityClosure.findUniqueOrThrow({
      where: { id: closure.id },
    })).status,
    'rejected',
  );
  assert.equal(
    (await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: closureApproval.id },
    })).status,
    'cancelled',
  );
  assert.equal(
    await prisma.accountabilityFunding.count({
      where: { oneTimeOrderId: closingAccountOrderId },
    }),
    1,
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
      clientRequestId: crypto.randomUUID(),
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

  await prisma.oneTimeOrderAssignment.updateMany({
    where: {
      oneTimeOrderId: lockedOrderId,
      userId: recipients[1]!.id,
      assignmentRoleCode: 'one_time_manager',
    },
    data: { isActive: false },
  });
  await prisma.user.update({
    where: { id: recipients[0]!.id },
    data: { isActive: false },
  });
  const filteredManagersResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${lockedOrderId}`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(filteredManagersResponse.status, 200);
  assert.deepEqual(
    ((await filteredManagersResponse.json()) as { managers: unknown[] })
      .managers,
    [],
  );
});
