import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { AuditService } from '../src/modules/audit/audit.service';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('accountability transitions are atomic and concurrency safe', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `accountability-concurrency-${Date.now()}`;
  const template = await prisma.user.findUniqueOrThrow({
    where: { login: 'manager1' },
  });
  const managerRole = await prisma.role.findUniqueOrThrow({
    where: { code: 'manager' },
  });
  const manager = await prisma.user.create({
    data: {
      login: marker,
      fullName: 'Менеджер конкурентного подотчета',
      passwordHash: template.passwordHash,
      isActive: true,
      roles: { create: { roleId: managerRole.id } },
    },
  });

  t.after(async () => {
    const account = await prisma.accountabilityAccount.findUnique({
      where: { userId: manager.id },
      include: {
        fundings: { select: { id: true } },
        expenses: { select: { id: true } },
        closures: { select: { id: true } },
      },
    });
    if (account) {
      const approvalRequests = await prisma.approvalRequest.findMany({
        where: {
          sourceEntityType: 'accountability_closure',
          sourceEntityId: { in: account.closures.map((item) => item.id) },
        },
        select: { id: true },
      });
      const entityIds = [
        ...account.fundings.map((item) => item.id),
        ...account.expenses.map((item) => item.id),
        ...account.closures.map((item) => item.id),
        ...approvalRequests.map((item) => item.id),
      ];
      await prisma.approvalRequest.deleteMany({
        where: {
          sourceEntityType: 'accountability_closure',
          sourceEntityId: { in: account.closures.map((item) => item.id) },
        },
      });
      await prisma.auditEvent.deleteMany({
        where: { entityId: { in: entityIds } },
      });
      await prisma.accountabilityExpense.deleteMany({
        where: { accountabilityAccountId: account.id },
      });
      await prisma.accountabilityClosure.deleteMany({
        where: { accountabilityAccountId: account.id },
      });
      await prisma.accountabilityFunding.deleteMany({
        where: { accountabilityAccountId: account.id },
      });
      await prisma.accountabilityAccount.delete({ where: { id: account.id } });
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
  const jsonRequest = (
    path: string,
    cookie: string,
    method: 'POST' | 'PATCH' = 'POST',
    body: unknown = {},
  ) =>
    fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const fundingResponse = await jsonRequest(
    `/accountability/accounts/${manager.id}/fundings`,
    founderCookie,
    'POST',
    { amount: 10000 },
  );
  assert.equal(fundingResponse.status, 201);

  const createDraft = async (description: string): Promise<string> => {
    const response = await jsonRequest(
      '/accountability/me/expenses',
      managerCookie,
      'POST',
      { amount: 100, description },
    );
    assert.equal(response.status, 201, await response.clone().text());
    return ((await response.json()) as { id: string }).id;
  };
  const submit = (expenseId: string) =>
    jsonRequest(
      `/accountability/me/expenses/${expenseId}/submit`,
      managerCookie,
    );
  const approve = (expenseId: string) =>
    jsonRequest(`/accountability/expenses/${expenseId}/approve`, founderCookie);
  const reject = (expenseId: string, comment = 'Отклонено конкурентно') =>
    jsonRequest(
      `/accountability/expenses/${expenseId}/reject`,
      founderCookie,
      'POST',
      { comment },
    );
  const expectOneConflict = async (
    requests: [Promise<Response>, Promise<Response>],
  ): Promise<void> => {
    const responses = await Promise.all(requests);
    assert.deepEqual(
      responses.map((response) => response.status).sort((a, b) => a - b),
      [200, 409],
    );
  };

  const auditService = app.get(AuditService);
  const originalWriteAuditEvent =
    auditService.writeAuditEvent.bind(auditService);
  auditService.writeAuditEvent = async (params, database) => {
    if (
      params.action === 'accountability_expense_created' &&
      params.newValues &&
      typeof params.newValues === 'object' &&
      !Array.isArray(params.newValues) &&
      'description' in params.newValues &&
      params.newValues.description === `${marker}-audit-failure`
    ) {
      throw new Error('Injected audit failure');
    }
    return originalWriteAuditEvent(params, database);
  };
  try {
    const failedCreate = await jsonRequest(
      '/accountability/me/expenses',
      managerCookie,
      'POST',
      { amount: 100, description: `${marker}-audit-failure` },
    );
    assert.equal(failedCreate.status, 500);
    assert.equal(
      await prisma.accountabilityExpense.count({
        where: { description: `${marker}-audit-failure` },
      }),
      0,
    );
  } finally {
    auditService.writeAuditEvent = originalWriteAuditEvent;
  }

  const duplicateSubmitId = await createDraft(`${marker}-submit`);
  await expectOneConflict([submit(duplicateSubmitId), submit(duplicateSubmitId)]);
  assert.equal(
    await prisma.auditEvent.count({
      where: {
        entityType: 'accountability_expense',
        entityId: duplicateSubmitId,
        action: 'accountability_expense_submitted',
      },
    }),
    1,
  );

  await expectOneConflict([
    approve(duplicateSubmitId),
    approve(duplicateSubmitId),
  ]);
  assert.equal(
    await prisma.auditEvent.count({
      where: {
        entityType: 'accountability_expense',
        entityId: duplicateSubmitId,
        action: 'accountability_expense_approved',
      },
    }),
    1,
  );

  const mixedResolveId = await createDraft(`${marker}-mixed-resolve`);
  assert.equal((await submit(mixedResolveId)).status, 200);
  await expectOneConflict([approve(mixedResolveId), reject(mixedResolveId)]);

  const duplicateRejectId = await createDraft(`${marker}-reject`);
  assert.equal((await submit(duplicateRejectId)).status, 200);
  await expectOneConflict([reject(duplicateRejectId), reject(duplicateRejectId)]);

  const submitUpdateId = await createDraft(`${marker}-submit-update`);
  const submitUpdateResponses = await Promise.all([
    submit(submitUpdateId),
    jsonRequest(
      `/accountability/me/expenses/${submitUpdateId}`,
      managerCookie,
      'PATCH',
      { amount: 200, description: `${marker}-updated` },
    ),
  ]);
  assert.ok(
    submitUpdateResponses.some((response) => response.status === 409),
    'submit/update race must reject a stale transition',
  );
  const submitUpdateExpense =
    await prisma.accountabilityExpense.findUniqueOrThrow({
      where: { id: submitUpdateId },
      select: { status: true },
    });
  if (submitUpdateExpense.status === 'submitted') {
    assert.equal((await approve(submitUpdateId)).status, 200);
  }
  await prisma.accountabilityExpense.deleteMany({
    where: { id: submitUpdateId, status: 'draft' },
  });

  const unresolvedId = await createDraft(`${marker}-closure-race`);
  assert.equal((await submit(unresolvedId)).status, 200);
  const approvalAndClosure = await Promise.all([
    approve(unresolvedId),
    jsonRequest('/accountability/me/closures/request', managerCookie),
  ]);
  assert.ok(approvalAndClosure.some((response) => response.status === 200));
  let closureResponse = approvalAndClosure[1];
  if (closureResponse.status === 409) {
    closureResponse = await jsonRequest(
      '/accountability/me/closures/request',
      managerCookie,
    );
  }
  assert.equal(closureResponse.status, 201);
  const closure = (await closureResponse.json()) as { id: string };
  await expectOneConflict([
    jsonRequest(
      `/accountability/closures/${closure.id}/approve`,
      founderCookie,
    ),
    jsonRequest(
      `/accountability/closures/${closure.id}/reject`,
      founderCookie,
      'POST',
      { comment: 'Параллельное отклонение' },
    ),
  ]);

  const secondClosureResponse = await jsonRequest(
    '/accountability/me/closures/request',
    managerCookie,
  );
  assert.equal(secondClosureResponse.status, 201);
  const secondClosure = (await secondClosureResponse.json()) as { id: string };
  const approvalRequest = await prisma.approvalRequest.findFirstOrThrow({
    where: {
      sourceEntityType: 'accountability_closure',
      sourceEntityId: secondClosure.id,
      status: 'pending',
    },
  });
  await expectOneConflict([
    jsonRequest(
      `/accountability/closures/${secondClosure.id}/approve`,
      founderCookie,
    ),
    jsonRequest(`/approvals/${approvalRequest.id}/approve`, founderCookie),
  ]);

  const finalAccount = await prisma.accountabilityAccount.findUniqueOrThrow({
    where: { userId: manager.id },
  });
  assert.equal(finalAccount.status, 'active');
});
