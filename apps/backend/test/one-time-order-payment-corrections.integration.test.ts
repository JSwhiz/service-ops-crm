import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { OneTimeOrdersService } from '../src/modules/one-time-orders/one-time-orders.service';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

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
  const secondaryManager = await prisma.user.create({
    data: {
      login: `${marker}-secondary`,
      fullName: 'Второй тестовый менеджер корректировок',
      passwordHash: templateManager.passwordHash,
      isActive: true,
      roles: { create: { roleId: managerRole.id } },
    },
  });
  const createdManagerIds = [manager.id, secondaryManager.id];

  t.after(async () => {
    if (usesIsolatedIntegrationDatabase()) {
      await app.close();
      await prisma.$disconnect();
      return;
    }
    const fundingIds = (
      await prisma.accountabilityFunding.findMany({
        where: {
          accountabilityAccount: { userId: { in: createdManagerIds } },
        },
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
      where: {
        accountabilityAccount: { userId: { in: createdManagerIds } },
      },
    });
    await prisma.accountabilityFunding.updateMany({
      where: { oneTimeOrderId: { in: createdOrderIds } },
      data: { reversalOfFundingId: null, reversedByFundingId: null },
    });
    await prisma.accountabilityFunding.deleteMany({
      where: {
        accountabilityAccount: { userId: { in: createdManagerIds } },
      },
    });
    await prisma.oneTimeOrderCompletionPayment.updateMany({
      where: { oneTimeOrderId: { in: createdOrderIds } },
      data: {
        reversalOfPaymentId: null,
        reversedByPaymentId: null,
        correctedFromPaymentId: null,
        correctedByPaymentId: null,
      },
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
      where: { userId: { in: createdManagerIds } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: createdManagerIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: createdManagerIds } },
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
  const createCompletedOrderWithPayments = async (params: {
    agreedSum: number;
    managerUserIds: string[];
    payments: Array<{
      amount: number;
      paymentMethod: string;
      paymentDestination: string;
      recipientUserId?: string;
    }>;
  }) => {
    const createResponse = await postJson(
      `${baseUrl}/api/v1/one-time-orders`,
      founderCookie,
      {
        title: `${marker}-${createdOrderIds.length + 1}`,
        executionAddress: 'Москва, адрес корректировки оплаты',
        status: 'in_progress',
        contactName: 'Тестовый заказчик',
        agreedSum: params.agreedSum,
        managerUserIds: params.managerUserIds,
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
        clientRequestId: crypto.randomUUID(),
        payments: params.payments,
      },
    );
    assert.equal(completeResponse.status, 201);
    const completion = (await completeResponse.json()) as CompletionResponse;
    return { orderId: order.id, completion };
  };
  const createCompletedOrder = async (params: {
    amount: number;
    paymentMethod: string;
    paymentDestination: string;
    recipientUserId?: string;
  }) => {
    const result = await createCompletedOrderWithPayments({
      agreedSum: params.amount,
      managerUserIds: [manager.id],
      payments: [params],
    });
    return {
      ...result,
      source: result.completion.payments[0]!,
    };
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

  const removedRecipient = await createCompletedOrder({
    amount: 120,
    paymentMethod: 'cash',
    paymentDestination: 'manager_accountability',
    recipientUserId: manager.id,
  });
  await prisma.oneTimeOrderAssignment.updateMany({
    where: {
      oneTimeOrderId: removedRecipient.orderId,
      userId: manager.id,
      assignmentRoleCode: 'one_time_manager',
    },
    data: { isActive: false },
  });
  const removedRecipientCorrection = await correct(
    removedRecipient.orderId,
    removedRecipient.source.id,
    {
      correctedAmount: 120,
      paymentMethod: 'cash',
      paymentDestination: 'manager_accountability',
      recipientUserId: manager.id,
      reason: 'Получатель больше не назначен на заказ',
    },
  );
  assert.equal(removedRecipientCorrection.status, 201);

  const activeRecipient = await createCompletedOrderWithPayments({
    agreedSum: 140,
    managerUserIds: [manager.id, secondaryManager.id],
    payments: [
      {
        amount: 140,
        paymentMethod: 'cash',
        paymentDestination: 'manager_accountability',
        recipientUserId: manager.id,
      },
    ],
  });
  const activeRecipientCorrection = await correct(
    activeRecipient.orderId,
    activeRecipient.completion.payments[0]!.id,
    {
      correctedAmount: 140,
      paymentMethod: 'cash',
      paymentDestination: 'manager_accountability',
      recipientUserId: secondaryManager.id,
      reason: 'Исправлен активный получатель',
    },
  );
  assert.equal(activeRecipientCorrection.status, 201);

  const historicalRecipient = await createCompletedOrderWithPayments({
    agreedSum: 200,
    managerUserIds: [manager.id, secondaryManager.id],
    payments: [
      {
        amount: 100,
        paymentMethod: 'cash',
        paymentDestination: 'manager_accountability',
        recipientUserId: manager.id,
      },
      {
        amount: 100,
        paymentMethod: 'cash',
        paymentDestination: 'manager_accountability',
        recipientUserId: secondaryManager.id,
      },
    ],
  });
  await prisma.oneTimeOrderAssignment.updateMany({
    where: {
      oneTimeOrderId: historicalRecipient.orderId,
      userId: secondaryManager.id,
      assignmentRoleCode: 'one_time_manager',
    },
    data: { isActive: false },
  });
  const historicalRecipientCorrection = await correct(
    historicalRecipient.orderId,
    historicalRecipient.completion.payments[0]!.id,
    {
      correctedAmount: 100,
      paymentMethod: 'cash',
      paymentDestination: 'manager_accountability',
      recipientUserId: secondaryManager.id,
      reason: 'Исправлен исторический получатель этого цикла',
    },
  );
  assert.equal(historicalRecipientCorrection.status, 201);

  const arbitraryRecipient = await createCompletedOrder({
    amount: 90,
    paymentMethod: 'cash',
    paymentDestination: 'manager_accountability',
    recipientUserId: manager.id,
  });
  const arbitraryRecipientCorrection = await correct(
    arbitraryRecipient.orderId,
    arbitraryRecipient.source.id,
    {
      correctedAmount: 90,
      paymentMethod: 'cash',
      paymentDestination: 'manager_accountability',
      recipientUserId: templateManager.id,
      reason: 'Попытка назначить произвольного пользователя',
    },
  );
  assert.equal(arbitraryRecipientCorrection.status, 400);

  const personalToOrganization = await createCompletedOrder({
    amount: 70,
    paymentMethod: 'cash',
    paymentDestination: 'manager_accountability',
    recipientUserId: manager.id,
  });
  const personalToOrganizationCorrection = await correct(
    personalToOrganization.orderId,
    personalToOrganization.source.id,
    {
      correctedAmount: 70,
      paymentMethod: 'organization_transfer',
      paymentDestination: 'organization',
      reason: 'Оплата фактически поступила организации',
    },
  );
  assert.equal(personalToOrganizationCorrection.status, 201);
  assert.equal(
    await prisma.accountabilityFunding.count({
      where: { oneTimeOrderId: personalToOrganization.orderId },
    }),
    2,
  );

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
      paymentMethod: 'cash',
      paymentDestination: 'manager_accountability',
      recipientUserId: manager.id,
      reason: 'Оплата фактически передана менеджеру',
    },
  );
  assert.equal(organizationCorrection.status, 201);
  assert.equal(
    await prisma.accountabilityFunding.count({
      where: { oneTimeOrderId: organization.orderId },
    }),
    1,
  );

  const auditFailure = await createCompletedOrder({
    amount: 60,
    paymentMethod: 'cash',
    paymentDestination: 'manager_accountability',
    recipientUserId: manager.id,
  });
  const service = app.get(OneTimeOrdersService) as unknown as {
    writeAuditEvent: (...args: unknown[]) => Promise<void>;
  };
  const originalWriteAuditEvent = service.writeAuditEvent.bind(service);
  service.writeAuditEvent = async (...args: unknown[]) => {
    const event = args[1] as { action?: string; entityId?: string } | undefined;
    if (
      event?.action === 'one_time_order.payment_corrected' &&
      event.entityId === auditFailure.orderId
    ) {
      throw new Error('Injected correction audit failure');
    }
    return originalWriteAuditEvent(...args);
  };
  try {
    const failedCorrection = await correct(
      auditFailure.orderId,
      auditFailure.source.id,
      {
        correctedAmount: 55,
        paymentMethod: 'cash',
        paymentDestination: 'manager_accountability',
        recipientUserId: manager.id,
        reason: 'Проверка атомарности аудита',
      },
    );
    assert.equal(failedCorrection.status, 500);
  } finally {
    service.writeAuditEvent = originalWriteAuditEvent;
  }
  const sourceAfterAuditFailure =
    await prisma.oneTimeOrderCompletionPayment.findUniqueOrThrow({
      where: { id: auditFailure.source.id },
    });
  assert.equal(sourceAfterAuditFailure.status, 'active');
  assert.equal(sourceAfterAuditFailure.reversedByPaymentId, null);
  assert.equal(sourceAfterAuditFailure.correctedByPaymentId, null);
  assert.equal(
    await prisma.oneTimeOrderCompletionPayment.count({
      where: { oneTimeOrderId: auditFailure.orderId },
    }),
    1,
  );
  assert.equal(
    await prisma.accountabilityFunding.count({
      where: { oneTimeOrderId: auditFailure.orderId },
    }),
    1,
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
    8,
  );

  const differenceAudit = await prisma.auditEvent.findFirstOrThrow({
    where: {
      entityType: 'one_time_order',
      entityId: personal.orderId,
      action: 'one_time_order.payment_corrected',
    },
  });
  const differenceMetadata = differenceAudit.metadata as Record<
    string,
    unknown
  >;
  assert.equal(differenceMetadata.cumulativeActiveAmount, 30000);
  assert.equal(differenceMetadata.agreedSum, 35000);
  assert.equal(differenceMetadata.createsFinancialDifference, true);
});
