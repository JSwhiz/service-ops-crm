import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/modules/auth/utils/password-hash.util';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

interface MePayload {
  capabilities: {
    canAccessAccountability: boolean;
    canViewOwnAccountability: boolean;
    canIssueAccountabilityFunds: boolean;
    canReviewAccountability: boolean;
    canApproveAccountabilityClosure: boolean;
  };
}

test('own accountability access follows manager assignment and receipt eligibility', async (t) => {
  const prisma = new PrismaClient();
  const marker = `accountability-access-${Date.now()}`;
  const password = 'accountability-access-123';
  const passwordHash = await hashPassword(password);
  const createdUserIds: string[] = [];
  const createdOrderIds: string[] = [];
  const { app, baseUrl } = await createTestApp();

  const [managerRole, hrRole, deputyFounderRole, founder] = await Promise.all([
    prisma.role.findUniqueOrThrow({ where: { code: 'manager' } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'hr' } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'deputy_founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
  ]);

  async function createUser(params: {
    suffix: string;
    roleId: string;
  }) {
    const user = await prisma.user.create({
      data: {
        login: `${marker}-${params.suffix}`,
        fullName: `Accountability access ${params.suffix}`,
        passwordHash,
        isActive: true,
        roles: {
          create: {
            roleId: params.roleId,
          },
        },
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  const [manager, assignedManager, receiptOwner, unrelated, deputyFounder] =
    await Promise.all([
      createUser({ suffix: 'manager', roleId: managerRole.id }),
      createUser({ suffix: 'assigned', roleId: hrRole.id }),
      createUser({ suffix: 'receipt', roleId: hrRole.id }),
      createUser({ suffix: 'unrelated', roleId: hrRole.id }),
      createUser({ suffix: 'deputy-founder', roleId: deputyFounderRole.id }),
    ]);

  const assignedOrder = await prisma.oneTimeOrder.create({
    data: {
      title: `${marker} assigned order`,
      executionAddress: 'Москва',
      status: 'new',
      contactName: 'Контакт',
      createdByUserId: founder.id,
      assignments: {
        create: {
          userId: assignedManager.id,
          assignmentRoleCode: 'one_time_manager',
          isActive: true,
        },
      },
    },
  });
  createdOrderIds.push(assignedOrder.id);

  await prisma.accountabilityAccount.create({
    data: {
      userId: receiptOwner.id,
      fundings: {
        create: {
          amount: 1500,
          comment: 'Историческое поступление по разовому заказу',
          issuedByUserId: founder.id,
          fundingType: 'one_time_order_receipt',
          entryDirection: 'credit',
          oneTimeOrderId: assignedOrder.id,
          recordedByUserId: founder.id,
        },
      },
    },
  });

  t.after(async () => {
    if (usesIsolatedIntegrationDatabase()) {
      await app.close();
      await prisma.$disconnect();
      return;
    }
    const accounts = await prisma.accountabilityAccount.findMany({
      where: { userId: { in: createdUserIds } },
      select: {
        id: true,
        fundings: { select: { id: true } },
        expenses: { select: { id: true } },
        closures: { select: { id: true } },
      },
    });
    const fundingIds = accounts.flatMap((account) =>
      account.fundings.map((funding) => funding.id),
    );
    const expenseIds = accounts.flatMap((account) =>
      account.expenses.map((expense) => expense.id),
    );
    const closureIds = accounts.flatMap((account) =>
      account.closures.map((closure) => closure.id),
    );

    await prisma.auditEvent.deleteMany({
      where: {
        OR: [
          { entityType: 'accountability_funding', entityId: { in: fundingIds } },
          { entityType: 'accountability_expense', entityId: { in: expenseIds } },
          { entityType: 'accountability_closure', entityId: { in: closureIds } },
        ],
      },
    });
    await prisma.accountabilityExpense.deleteMany({
      where: { accountabilityAccountId: { in: accounts.map((account) => account.id) } },
    });
    await prisma.accountabilityClosure.deleteMany({
      where: { accountabilityAccountId: { in: accounts.map((account) => account.id) } },
    });
    await prisma.accountabilityFunding.deleteMany({
      where: { accountabilityAccountId: { in: accounts.map((account) => account.id) } },
    });
    await prisma.accountabilityAccount.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.oneTimeOrderAssignment.deleteMany({
      where: { oneTimeOrderId: { in: createdOrderIds } },
    });
    await prisma.oneTimeOrder.deleteMany({
      where: { id: { in: createdOrderIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  const [
    managerCookie,
    assignedCookie,
    receiptCookie,
    unrelatedCookie,
    deputyFounderCookie,
    founderCookie,
  ] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: manager.login, password }),
    loginAndGetCookieHeader({ baseUrl, login: assignedManager.login, password }),
    loginAndGetCookieHeader({ baseUrl, login: receiptOwner.login, password }),
    loginAndGetCookieHeader({ baseUrl, login: unrelated.login, password }),
    loginAndGetCookieHeader({ baseUrl, login: deputyFounder.login, password }),
    loginAndGetCookieHeader({
      baseUrl,
      login: 'founder',
      password: 'founder123',
    }),
  ]);

  async function getMe(cookie: string): Promise<MePayload> {
    const response = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    return (await response.json()) as MePayload;
  }

  for (const cookie of [managerCookie, assignedCookie, receiptCookie]) {
    const me = await getMe(cookie);
    assert.equal(me.capabilities.canViewOwnAccountability, true);
    assert.equal(me.capabilities.canAccessAccountability, true);

    const ownResponse = await fetch(`${baseUrl}/api/v1/accountability/me`, {
      headers: { Cookie: cookie },
    });
    assert.equal(ownResponse.status, 200);
  }

  const receiptOwnResponse = await fetch(
    `${baseUrl}/api/v1/accountability/me`,
    { headers: { Cookie: receiptCookie } },
  );
  const receiptOwnPayload = (await receiptOwnResponse.json()) as {
    fundings: Array<{ fundingType: string }>;
  };
  assert.equal(receiptOwnPayload.fundings[0]?.fundingType, 'one_time_order_receipt');

  const unrelatedMe = await getMe(unrelatedCookie);
  assert.equal(unrelatedMe.capabilities.canViewOwnAccountability, false);
  assert.equal(unrelatedMe.capabilities.canAccessAccountability, false);

  const unrelatedOwnResponse = await fetch(
    `${baseUrl}/api/v1/accountability/me`,
    { headers: { Cookie: unrelatedCookie } },
  );
  assert.equal(unrelatedOwnResponse.status, 403);

  const unrelatedExpenseResponse = await fetch(
    `${baseUrl}/api/v1/accountability/me/expenses`,
    {
      method: 'POST',
      headers: {
        Cookie: unrelatedCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 100, description: 'Недоступный расход' }),
    },
  );
  assert.equal(unrelatedExpenseResponse.status, 403);
  assert.equal(
    await prisma.accountabilityAccount.count({ where: { userId: unrelated.id } }),
    0,
  );

  const reviewPermission = await prisma.permission.findUniqueOrThrow({
    where: { code: 'accountability.review' },
  });
  await prisma.userPermission.create({
    data: { userId: unrelated.id, permissionId: reviewPermission.id },
  });
  const directReviewerMe = await getMe(unrelatedCookie);
  assert.equal(directReviewerMe.capabilities.canReviewAccountability, true);
  assert.equal(directReviewerMe.capabilities.canAccessAccountability, true);
  const directReviewerAccounts = await fetch(
    `${baseUrl}/api/v1/accountability/accounts`,
    { headers: { Cookie: unrelatedCookie } },
  );
  assert.equal(directReviewerAccounts.status, 200);

  const managerForeignResponse = await fetch(
    `${baseUrl}/api/v1/accountability/accounts/${receiptOwner.id}`,
    { headers: { Cookie: managerCookie } },
  );
  assert.equal(managerForeignResponse.status, 403);

  const deputyFounderMe = await getMe(deputyFounderCookie);
  assert.equal(deputyFounderMe.capabilities.canViewOwnAccountability, false);
  assert.equal(deputyFounderMe.capabilities.canReviewAccountability, true);
  assert.equal(deputyFounderMe.capabilities.canIssueAccountabilityFunds, false);
  assert.equal(
    deputyFounderMe.capabilities.canApproveAccountabilityClosure,
    true,
  );
  assert.equal(deputyFounderMe.capabilities.canAccessAccountability, true);

  const deputyFounderAccountsResponse = await fetch(
    `${baseUrl}/api/v1/accountability/accounts`,
    { headers: { Cookie: deputyFounderCookie } },
  );
  assert.equal(deputyFounderAccountsResponse.status, 200);

  const deputyFounderIssueResponse = await fetch(
    `${baseUrl}/api/v1/accountability/accounts/${assignedManager.id}/fundings`,
    {
      method: 'POST',
      headers: {
        Cookie: deputyFounderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 500 }),
    },
  );
  assert.equal(deputyFounderIssueResponse.status, 403);

  const founderMe = await getMe(founderCookie);
  assert.equal(founderMe.capabilities.canIssueAccountabilityFunds, true);
  assert.equal(founderMe.capabilities.canReviewAccountability, true);

  const founderAccountsResponse = await fetch(
    `${baseUrl}/api/v1/accountability/accounts`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(founderAccountsResponse.status, 200);

  const founderIssueResponse = await fetch(
    `${baseUrl}/api/v1/accountability/accounts/${assignedManager.id}/fundings`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: 500, comment: 'Проверка issuer access' }),
    },
  );
  assert.equal(founderIssueResponse.status, 201);
});
