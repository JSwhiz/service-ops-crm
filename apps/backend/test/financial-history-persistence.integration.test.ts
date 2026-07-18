import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma, PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('financial history rejects destructive deletes and direct mutations', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `financial-persistence-${Date.now()}`;
  const template = await prisma.user.findUniqueOrThrow({
    where: { login: 'manager1' },
  });
  const managerRole = await prisma.role.findUniqueOrThrow({
    where: { code: 'manager' },
  });
  const manager = await prisma.user.create({
    data: {
      login: marker,
      fullName: 'Менеджер проверки финансовой истории',
      passwordHash: template.passwordHash,
      isActive: true,
      roles: { create: { roleId: managerRole.id } },
    },
  });
  let orderId: string | null = null;

  t.after(async () => {
    if (orderId) {
      const completionIds = (
        await prisma.oneTimeOrderCompletion.findMany({
          where: { oneTimeOrderId: orderId },
          select: { id: true },
        })
      ).map((item) => item.id);
      const paymentIds = (
        await prisma.oneTimeOrderCompletionPayment.findMany({
          where: { oneTimeOrderId: orderId },
          select: { id: true },
        })
      ).map((item) => item.id);
      const account = await prisma.accountabilityAccount.findUnique({
        where: { userId: manager.id },
        include: {
          fundings: { select: { id: true } },
          expenses: { select: { id: true } },
          closures: { select: { id: true } },
        },
      });
      const financialIds = [
        ...completionIds,
        ...paymentIds,
        ...(account?.fundings.map((item) => item.id) ?? []),
        ...(account?.expenses.map((item) => item.id) ?? []),
        ...(account?.closures.map((item) => item.id) ?? []),
        orderId,
      ];
      await prisma.auditEvent.deleteMany({
        where: { entityId: { in: financialIds } },
      });
      if (account) {
        await prisma.accountabilityExpense.deleteMany({
          where: { accountabilityAccountId: account.id },
        });
        await prisma.accountabilityClosure.deleteMany({
          where: { accountabilityAccountId: account.id },
        });
        await prisma.accountabilityFunding.deleteMany({
          where: { accountabilityAccountId: account.id },
        });
      }
      await prisma.oneTimeOrderCompletionPayment.deleteMany({
        where: { oneTimeOrderId: orderId },
      });
      await prisma.oneTimeOrderCompletion.deleteMany({
        where: { oneTimeOrderId: orderId },
      });
      await prisma.oneTimeOrder.delete({ where: { id: orderId } });
      if (account) {
        await prisma.accountabilityAccount.delete({ where: { id: account.id } });
      }
    }
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
  const postJson = (path: string, cookie: string, body: unknown = {}) =>
    fetch(`${baseUrl}/api/v1${path}`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const createOrderResponse = await postJson(
    '/one-time-orders',
    founderCookie,
    {
      title: marker,
      executionAddress: 'Москва',
      status: 'in_progress',
      contactName: 'Заказчик',
      agreedSum: 1000,
      managerUserIds: [manager.id],
    },
  );
  assert.equal(createOrderResponse.status, 201);
  orderId = ((await createOrderResponse.json()) as { id: string }).id;
  const completeResponse = await postJson(
    `/one-time-orders/${orderId}/complete`,
    founderCookie,
    {
      workCycle: 1,
      clientRequestId: crypto.randomUUID(),
      payments: [
        {
          recipientUserId: manager.id,
          amount: 1000,
          paymentMethod: 'cash',
          paymentDestination: 'manager_accountability',
        },
      ],
    },
  );
  assert.equal(completeResponse.status, 201);
  const completion = (await completeResponse.json()) as {
    id: string;
    payments: Array<{ id: string }>;
  };
  const paymentId = completion.payments[0]!.id;
  const funding = await prisma.accountabilityFunding.findUniqueOrThrow({
    where: { oneTimeOrderPaymentId: paymentId },
  });

  const createExpenseResponse = await postJson(
    '/accountability/me/expenses',
    managerCookie,
    { amount: 100, description: 'Проведенный расход' },
  );
  assert.equal(createExpenseResponse.status, 201);
  const expenseId = ((await createExpenseResponse.json()) as { id: string }).id;
  assert.equal(
    (await postJson(
      `/accountability/me/expenses/${expenseId}/submit`,
      managerCookie,
    )).status,
    200,
  );
  const account = await prisma.accountabilityAccount.findUniqueOrThrow({
    where: { userId: manager.id },
  });

  const expectDatabaseRejection = async (
    operation: () => Promise<unknown>,
  ): Promise<void> => {
    await assert.rejects(operation, (error: unknown) => {
      return (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientUnknownRequestError
      );
    });
  };

  await expectDatabaseRejection(() =>
    prisma.oneTimeOrder.delete({ where: { id: orderId! } }),
  );
  await expectDatabaseRejection(() =>
    prisma.oneTimeOrderCompletion.delete({ where: { id: completion.id } }),
  );
  await expectDatabaseRejection(() =>
    prisma.accountabilityAccount.delete({ where: { id: account.id } }),
  );
  await expectDatabaseRejection(() =>
    prisma.oneTimeOrderCompletionPayment.update({
      where: { id: paymentId },
      data: { amount: 999 },
    }),
  );
  await expectDatabaseRejection(() =>
    prisma.accountabilityFunding.update({
      where: { id: funding.id },
      data: { amount: 999 },
    }),
  );
  await expectDatabaseRejection(() =>
    prisma.accountabilityExpense.update({
      where: { id: expenseId },
      data: { amount: 999 },
    }),
  );

  assert.equal(
    await prisma.oneTimeOrderCompletion.count({ where: { id: completion.id } }),
    1,
  );
  assert.equal(
    await prisma.oneTimeOrderCompletionPayment.count({ where: { id: paymentId } }),
    1,
  );
  assert.equal(
    await prisma.accountabilityFunding.count({ where: { id: funding.id } }),
    1,
  );
  assert.equal(
    await prisma.accountabilityExpense.count({ where: { id: expenseId } }),
    1,
  );
});
