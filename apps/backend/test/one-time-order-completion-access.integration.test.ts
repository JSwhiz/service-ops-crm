import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

interface PaymentResponse {
  id: string;
  detailsRestricted: boolean;
  recipient?: { id: string } | null;
  amount?: number;
  paymentMethod?: string;
  paymentDestination?: string;
  comment?: string | null;
  differenceReason?: string | null;
}

interface CompletionResponse {
  id: string;
  visibleTotalAmount: number;
  fullTotalAmountVisible: boolean;
  payments: PaymentResponse[];
}

test('completion payments expose only permitted financial details', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `completion-access-${Date.now()}`;
  const templateManager = await prisma.user.findUniqueOrThrow({
    where: { login: 'manager1' },
  });
  const managerRole = await prisma.role.findUniqueOrThrow({
    where: { code: 'manager' },
  });
  const managers = await Promise.all(
    [1, 2].map((index) =>
      prisma.user.create({
        data: {
          login: `${marker}-${index}`,
          fullName: `Менеджер приватности ${index}`,
          passwordHash: templateManager.passwordHash,
          isActive: true,
          roles: { create: { roleId: managerRole.id } },
        },
      }),
    ),
  );
  const managerA = managers[0]!;
  const managerB = managers[1]!;
  let orderId: string | null = null;

  t.after(async () => {
    if (usesIsolatedIntegrationDatabase()) {
      await app.close();
      await prisma.$disconnect();
      return;
    }
    if (orderId) {
      const fundingIds = (
        await prisma.accountabilityFunding.findMany({
          where: { oneTimeOrderId: orderId },
          select: { id: true },
        })
      ).map((funding) => funding.id);
      await prisma.auditEvent.deleteMany({
        where: {
          OR: [
            { entityType: 'one_time_order', entityId: orderId },
            { entityType: 'accountability_funding', entityId: { in: fundingIds } },
          ],
        },
      });
      await prisma.accountabilityFunding.deleteMany({
        where: { oneTimeOrderId: orderId },
      });
      await prisma.oneTimeOrderCompletionPayment.deleteMany({
        where: { oneTimeOrderId: orderId },
      });
      await prisma.oneTimeOrderCompletion.deleteMany({
        where: { oneTimeOrderId: orderId },
      });
      await prisma.oneTimeOrder.delete({ where: { id: orderId } });
    }
    await prisma.accountabilityAccount.deleteMany({
      where: { userId: { in: managers.map((manager) => manager.id) } },
    });
    await prisma.userPermission.deleteMany({
      where: { userId: { in: managers.map((manager) => manager.id) } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: managers.map((manager) => manager.id) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: managers.map((manager) => manager.id) } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  const [founderCookie, managerACookie, managerBCookie] = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: 'founder',
      password: 'founder123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: managerA.login,
      password: 'manager123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: managerB.login,
      password: 'manager123',
    }),
  ]);
  const createResponse = await fetch(`${baseUrl}/api/v1/one-time-orders`, {
    method: 'POST',
    headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: marker,
      executionAddress: 'Москва',
      status: 'in_progress',
      contactName: 'Заказчик',
      agreedSum: 35000,
      managerUserIds: [managerA.id, managerB.id],
    }),
  });
  assert.equal(createResponse.status, 201);
  orderId = ((await createResponse.json()) as { id: string }).id;

  const completeResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${orderId}/complete`,
    {
      method: 'POST',
      headers: { Cookie: managerACookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workCycle: 1,
        clientRequestId: crypto.randomUUID(),
        payments: [
          {
            recipientUserId: managerA.id,
            amount: 10000,
            paymentMethod: 'cash',
            paymentDestination: 'manager_accountability',
          },
          {
            recipientUserId: managerB.id,
            amount: 15000,
            paymentMethod: 'personal_card_transfer',
            paymentDestination: 'manager_accountability',
          },
          {
            amount: 10000,
            paymentMethod: 'organization_transfer',
            paymentDestination: 'organization',
          },
        ],
      }),
    },
  );
  assert.equal(completeResponse.status, 201, await completeResponse.clone().text());
  const managerACompletion =
    (await completeResponse.json()) as CompletionResponse;
  assert.equal(managerACompletion.visibleTotalAmount, 20000);
  assert.equal(managerACompletion.fullTotalAmountVisible, false);
  assert.equal(
    managerACompletion.payments.filter((payment) => payment.detailsRestricted)
      .length,
    1,
  );

  const listFor = async (cookie: string): Promise<CompletionResponse> => {
    const response = await fetch(
      `${baseUrl}/api/v1/one-time-orders/${orderId}/completions`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(response.status, 200);
    return ((await response.json()) as CompletionResponse[])[0]!;
  };
  const managerBCompletion = await listFor(managerBCookie);
  assert.equal(managerBCompletion.visibleTotalAmount, 15000);
  assert.equal(managerBCompletion.fullTotalAmountVisible, false);
  assert.equal(
    managerBCompletion.payments.filter((payment) => payment.detailsRestricted)
      .length,
    2,
  );
  for (const hidden of managerBCompletion.payments.filter(
    (payment) => payment.detailsRestricted,
  )) {
    assert.deepEqual(Object.keys(hidden).sort(), ['detailsRestricted', 'id']);
  }

  const reviewerCompletion = await listFor(founderCookie);
  assert.equal(reviewerCompletion.visibleTotalAmount, 35000);
  assert.equal(reviewerCompletion.fullTotalAmountVisible, true);
  assert.ok(
    reviewerCompletion.payments.every(
      (payment) => payment.detailsRestricted === false,
    ),
  );

  const correctPermission = await prisma.permission.findUniqueOrThrow({
    where: { code: 'accountability.correct_receipt' },
  });
  await prisma.userPermission.create({
    data: { userId: managerB.id, permissionId: correctPermission.id },
  });
  const correctorCompletion = await listFor(managerBCookie);
  assert.equal(correctorCompletion.visibleTotalAmount, 35000);
  assert.equal(correctorCompletion.fullTotalAmountVisible, true);
});
