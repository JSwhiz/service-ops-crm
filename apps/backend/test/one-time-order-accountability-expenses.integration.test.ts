import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('one-time order expenses keep own scope safe files and ledger balances', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `order-expenses-${Date.now()}`;
  const createdUserIds: string[] = [];
  const createdOrderIds: string[] = [];
  const templateManager = await prisma.user.findUniqueOrThrow({
    where: { login: 'manager1' },
  });
  const managerRole = await prisma.role.findUniqueOrThrow({
    where: { code: 'manager' },
  });
  const managers = await Promise.all(
    ['first', 'second', 'outsider'].map((suffix) =>
      prisma.user.create({
        data: {
          login: `${marker}-${suffix}`,
          fullName: `Менеджер расходов ${suffix}`,
          passwordHash: templateManager.passwordHash,
          isActive: true,
          roles: { create: { roleId: managerRole.id } },
        },
      }),
    ),
  );
  createdUserIds.push(...managers.map((user) => user.id));

  t.after(async () => {
    const expenses = await prisma.accountabilityExpense.findMany({
      where: { accountabilityAccount: { userId: { in: createdUserIds } } },
      select: { id: true },
    });
    const expenseIds = expenses.map((expense) => expense.id);
    const fileAttachments = await prisma.fileAttachment.findMany({
      where: {
        entityType: 'accountability_expense',
        entityId: { in: expenseIds },
      },
      select: { fileId: true },
    });
    const fileIds = fileAttachments.map((attachment) => attachment.fileId);
    const fundingIds = (
      await prisma.accountabilityFunding.findMany({
        where: { accountabilityAccount: { userId: { in: createdUserIds } } },
        select: { id: true },
      })
    ).map((funding) => funding.id);

    await prisma.auditEvent.deleteMany({
      where: {
        OR: [
          { actorUserId: { in: createdUserIds } },
          { entityType: 'one_time_order', entityId: { in: createdOrderIds } },
          { entityType: 'accountability_expense', entityId: { in: expenseIds } },
          { entityType: 'accountability_funding', entityId: { in: fundingIds } },
        ],
      },
    });
    await prisma.fileAttachment.deleteMany({
      where: {
        entityType: 'accountability_expense',
        entityId: { in: expenseIds },
      },
    });
    await prisma.file.deleteMany({ where: { id: { in: fileIds } } });
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
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  const cookies = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: 'founder',
      password: 'founder123',
    }),
    ...managers.map((manager) =>
      loginAndGetCookieHeader({
        baseUrl,
        login: manager.login,
        password: 'manager123',
      }),
    ),
  ]);
  const founderCookie = cookies[0]!;
  const firstCookie = cookies[1]!;
  const secondCookie = cookies[2]!;
  const outsiderCookie = cookies[3]!;
  const postJson = (url: string, cookie: string, body: unknown) =>
    fetch(url, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const createOrderResponse = await postJson(
    `${baseUrl}/api/v1/one-time-orders`,
    founderCookie,
    {
      title: marker,
      executionAddress: 'Москва, расходы по заказу',
      status: 'in_progress',
      contactName: 'Заказчик',
      agreedSum: 2000,
      managerUserIds: [managers[0]!.id, managers[1]!.id],
    },
  );
  assert.equal(createOrderResponse.status, 201);
  const order = (await createOrderResponse.json()) as { id: string };
  createdOrderIds.push(order.id);

  const completeResponse = await postJson(
    `${baseUrl}/api/v1/one-time-orders/${order.id}/complete`,
    firstCookie,
    {
      workCycle: 1,
      clientRequestId: `${marker}-complete`,
      payments: managers.slice(0, 2).map((manager) => ({
        recipientUserId: manager.id,
        amount: 1000,
        paymentMethod: 'cash',
        paymentDestination: 'manager_accountability',
      })),
    },
  );
  assert.equal(completeResponse.status, 201);
  const completion = (await completeResponse.json()) as { id: string };

  await prisma.oneTimeOrderAssignment.updateMany({
    where: {
      oneTimeOrderId: order.id,
      userId: managers[0]!.id,
      assignmentRoleCode: 'one_time_manager',
    },
    data: { isActive: false },
  });

  await prisma.accountabilityAccount.create({
    data: { userId: managers[2]!.id, status: 'active' },
  });

  const missingMetadataResponse = await postJson(
    `${baseUrl}/api/v1/accountability/me/expenses`,
    firstCookie,
    {
      amount: 50,
      description: 'Нет категории и даты',
      oneTimeOrderId: order.id,
    },
  );
  assert.equal(missingMetadataResponse.status, 400);

  const inaccessibleOrderResponse = await postJson(
    `${baseUrl}/api/v1/accountability/me/expenses`,
    outsiderCookie,
    {
      amount: 50,
      description: 'Чужой заказ',
      oneTimeOrderId: order.id,
      expenseCategory: 'other',
      expenseDate: '2026-07-17',
    },
  );
  assert.equal(inaccessibleOrderResponse.status, 404);

  const createFirstExpenseResponse = await postJson(
    `${baseUrl}/api/v1/accountability/me/expenses`,
    firstCookie,
    {
      amount: 200,
      description: 'Доставка материалов',
      oneTimeOrderId: order.id,
      oneTimeOrderCompletionId: completion.id,
      expenseCategory: 'delivery',
      expenseDate: '2026-07-17',
    },
  );
  assert.equal(createFirstExpenseResponse.status, 201);
  const firstExpense = (await createFirstExpenseResponse.json()) as {
    id: string;
    oneTimeOrderId: string;
    oneTimeOrderCompletionId: string;
    expenseCategory: string;
    expenseDate: string;
  };
  assert.equal(firstExpense.oneTimeOrderId, order.id);
  assert.equal(firstExpense.oneTimeOrderCompletionId, completion.id);
  assert.equal(firstExpense.expenseCategory, 'delivery');
  assert.equal(firstExpense.expenseDate, '2026-07-17');

  const otherOrder = await prisma.oneTimeOrder.create({
    data: {
      title: `${marker}-other-cycle`,
      executionAddress: 'Москва, другой цикл',
      contactName: 'Другой заказчик',
      status: 'completed',
      workCycle: 1,
      createdByUserId: managers[0]!.id,
      assignments: {
        create: {
          userId: managers[0]!.id,
          assignmentRoleCode: 'one_time_manager',
          isActive: true,
        },
      },
    },
  });
  createdOrderIds.push(otherOrder.id);
  const otherCompletion = await prisma.oneTimeOrderCompletion.create({
    data: {
      oneTimeOrderId: otherOrder.id,
      workCycle: 1,
      completedAt: new Date(),
      completedByUserId: managers[0]!.id,
      completionSource: 'native',
      status: 'active',
    },
  });
  const mismatchedCompletionResponse = await postJson(
    `${baseUrl}/api/v1/accountability/me/expenses`,
    firstCookie,
    {
      amount: 60,
      description: 'Цикл другого заказа',
      oneTimeOrderId: order.id,
      oneTimeOrderCompletionId: otherCompletion.id,
      expenseCategory: 'other',
      expenseDate: '2026-07-17',
    },
  );
  assert.equal(mismatchedCompletionResponse.status, 404);

  const preCompletionOrderResponse = await postJson(
    `${baseUrl}/api/v1/one-time-orders`,
    founderCookie,
    {
      title: `${marker}-pre-completion`,
      executionAddress: 'Москва, текущая поездка',
      status: 'in_progress',
      contactName: 'Заказчик текущей поездки',
      managerUserIds: [managers[1]!.id],
    },
  );
  assert.equal(preCompletionOrderResponse.status, 201);
  const preCompletionOrder =
    (await preCompletionOrderResponse.json()) as { id: string };
  createdOrderIds.push(preCompletionOrder.id);
  const preCompletionExpenseResponse = await postJson(
    `${baseUrl}/api/v1/accountability/me/expenses`,
    secondCookie,
    {
      amount: 75,
      description: 'Расход до завершения поездки',
      oneTimeOrderId: preCompletionOrder.id,
      expenseCategory: 'transport',
      expenseDate: '2026-07-17',
    },
  );
  assert.equal(preCompletionExpenseResponse.status, 201);
  assert.equal(
    ((await preCompletionExpenseResponse.json()) as {
      oneTimeOrderCompletionId: string | null;
    }).oneTimeOrderCompletionId,
    null,
  );

  const submitWithoutFileResponse = await postJson(
    `${baseUrl}/api/v1/accountability/me/expenses/${firstExpense.id}/submit`,
    firstCookie,
    {},
  );
  assert.equal(submitWithoutFileResponse.status, 409);

  const uploadForm = new FormData();
  uploadForm.set('entityType', 'accountability_expense');
  uploadForm.set('entityId', firstExpense.id);
  uploadForm.set(
    'file',
    new Blob(['order expense receipt'], { type: 'text/plain' }),
    'receipt.txt',
  );
  const uploadResponse = await fetch(`${baseUrl}/api/v1/files/upload`, {
    method: 'POST',
    headers: { Cookie: firstCookie },
    body: uploadForm,
  });
  assert.equal(uploadResponse.status, 201);
  const uploadedFile = (await uploadResponse.json()) as { id: string };

  await prisma.file.update({
    where: { id: uploadedFile.id },
    data: { deletedAt: new Date() },
  });
  const submitWithDeletedFileResponse = await postJson(
    `${baseUrl}/api/v1/accountability/me/expenses/${firstExpense.id}/submit`,
    firstCookie,
    {},
  );
  assert.equal(submitWithDeletedFileResponse.status, 409);

  await prisma.file.update({
    where: { id: uploadedFile.id },
    data: { deletedAt: null },
  });

  const submitResponse = await postJson(
    `${baseUrl}/api/v1/accountability/me/expenses/${firstExpense.id}/submit`,
    firstCookie,
    {},
  );
  assert.equal(submitResponse.status, 200);

  const createSecondExpenseResponse = await postJson(
    `${baseUrl}/api/v1/accountability/me/expenses`,
    secondCookie,
    {
      amount: 300,
      description: 'Транспорт',
      oneTimeOrderId: order.id,
      expenseCategory: 'transport',
      expenseDate: '2026-07-17',
    },
  );
  assert.equal(createSecondExpenseResponse.status, 201);

  const firstViewResponse = await fetch(
    `${baseUrl}/api/v1/accountability/orders/${order.id}`,
    { headers: { Cookie: firstCookie } },
  );
  assert.equal(firstViewResponse.status, 200);
  const firstView = (await firstViewResponse.json()) as {
    visibilityScope: string;
    accounts: Array<{
      user: { id: string };
      summary: { currentBalance: number; forecastBalance: number };
      fundings: Array<{ amount: number }>;
      expenses: Array<{
        id: string;
        attachments: Array<Record<string, unknown>>;
      }>;
    }>;
  };
  assert.equal(firstView.visibilityScope, 'own');
  assert.equal(firstView.accounts.length, 1);
  assert.equal(firstView.accounts[0]?.user.id, managers[0]!.id);
  assert.equal(firstView.accounts[0]?.fundings.length, 1);
  assert.equal(firstView.accounts[0]?.expenses.length, 1);
  assert.equal(firstView.accounts[0]?.summary.currentBalance, 1000);
  assert.equal(firstView.accounts[0]?.summary.forecastBalance, 800);
  const safeAttachment = firstView.accounts[0]?.expenses[0]?.attachments[0];
  assert.ok(safeAttachment);
  assert.equal(safeAttachment.originalName, 'receipt.txt');
  assert.equal(typeof safeAttachment.viewUrl, 'string');
  assert.equal(typeof safeAttachment.downloadUrl, 'string');
  assert.equal('bucket' in safeAttachment, false);
  assert.equal('objectKey' in safeAttachment, false);
  assert.equal('attachments' in safeAttachment, false);

  const foreignFileResponse = await fetch(
    `${baseUrl}${String(safeAttachment.viewUrl)}`,
    { headers: { Cookie: secondCookie } },
  );
  assert.equal(foreignFileResponse.status, 403);

  const founderViewResponse = await fetch(
    `${baseUrl}/api/v1/accountability/orders/${order.id}`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(founderViewResponse.status, 200);
  const founderView = (await founderViewResponse.json()) as {
    visibilityScope: string;
    accounts: Array<{ user: { id: string } }>;
  };
  assert.equal(founderView.visibilityScope, 'administrative');
  assert.deepEqual(
    new Set(founderView.accounts.map((account) => account.user.id)),
    new Set([managers[0]!.id, managers[1]!.id]),
  );

  const outsiderViewResponse = await fetch(
    `${baseUrl}/api/v1/accountability/orders/${order.id}`,
    { headers: { Cookie: outsiderCookie } },
  );
  assert.equal(outsiderViewResponse.status, 404);

  const approveResponse = await postJson(
    `${baseUrl}/api/v1/accountability/expenses/${firstExpense.id}/approve`,
    founderCookie,
    {},
  );
  assert.equal(approveResponse.status, 200);

  const approvedViewResponse = await fetch(
    `${baseUrl}/api/v1/accountability/orders/${order.id}`,
    { headers: { Cookie: firstCookie } },
  );
  const approvedView = (await approvedViewResponse.json()) as {
    accounts: Array<{
      summary: { currentBalance: number; forecastBalance: number };
    }>;
  };
  assert.equal(approvedView.accounts[0]?.summary.currentBalance, 800);
  assert.equal(approvedView.accounts[0]?.summary.forecastBalance, 800);
});
