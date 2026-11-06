import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { SEEDED_EMPLOYEE_IDS } from './helpers/core-fixtures';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// General PAY-01..05 regression. The customer's unidentified order is unresolved.
async function financeFixture(t: TestContext) {
  assert.equal(usesIsolatedIntegrationDatabase(), true,
    'Run only through the isolated integration runner; never against a shared schema');
  const schema = new URL(process.env.DATABASE_URL!).searchParams.get('schema');
  assert.match(schema ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  const { app, baseUrl } = await createTestApp();
  t.after(() => app.close());
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const managerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
  const marker = `acl-finance-${randomUUID()}`;
  const owners = await Promise.all(['first', 'second'].map((suffix) => prisma.user.create({
    data: {
      login: `${marker}-${suffix}`, fullName: `ACL finance ${suffix}`,
      passwordHash: template.passwordHash, isActive: true,
      roles: { create: { roleId: managerRole.id } },
    },
  })));
  const order = await prisma.oneTimeOrder.create({ data: {
    title: marker, executionAddress: 'Isolated finance fixture', contactName: 'Fixture',
    status: 'in_progress', createdByUserId: founder.id,
    executionStartDate: new Date('2026-10-01T00:00:00Z'),
    executionEndDate: new Date('2026-10-03T00:00:00Z'),
    assignments: { create: owners.map((owner) => ({
      userId: owner.id, assignmentRoleCode: 'one_time_manager', isActive: true,
    })) },
  } });
  const accounts = await Promise.all(owners.map((owner) => prisma.accountabilityAccount.create({
    data: {
      userId: owner.id,
      fundings: { create: {
        amount: 2000, comment: 'Confirmed receipt attributable to this order',
        issuedByUserId: founder.id, recordedByUserId: founder.id,
        fundingType: 'one_time_order_receipt', entryDirection: 'credit', oneTimeOrderId: order.id,
      } },
    },
  })));
  const cookies = await Promise.all(owners.map((owner) => loginAndGetCookieHeader({
    baseUrl, login: owner.login, password: 'manager123',
  })));
  const founderCookie = await loginAndGetCookieHeader({
    baseUrl, login: 'founder', password: 'founder123',
  });
  const request = (path: string, cookie: string, body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const workforce = `/one-time-orders/${order.id}/workforce`;
  const addEmployee = await request(`${workforce}/employees`, cookies[0], {
    employeeId: SEEDED_EMPLOYEE_IDS.ivan,
  });
  assert.equal(addEmployee.status, 201, await addEmployee.clone().text());
  await prisma.$executeRaw`
    UPDATE "one_time_order_employee_assignments"
    SET "assignedAt" = '2026-09-30T00:00:00Z'::TIMESTAMPTZ
    WHERE "oneTimeOrderId" = ${order.id} AND "employeeId" = ${SEEDED_EMPLOYEE_IDS.ivan}
      AND "workCycle" = 1
  `;
  const payout = async (ownerIndex: number, amount: number) => {
    const response = await request('/accountability/me/expenses', cookies[ownerIndex], {
      amount, description: `Independent payout ${ownerIndex}`, oneTimeOrderId: order.id,
      oneTimeOrderWorkCycle: 1, employeeId: SEEDED_EMPLOYEE_IDS.ivan,
      expenseCategory: 'employee_payout', expenseDate: '2026-10-01',
    });
    assert.equal(response.status, 201, await response.clone().text());
    return response.json() as Promise<{ id: string; status: string }>;
  };
  const payroll = async () => {
    const response = await request(`${workforce}/timesheet?month=2026-10&workCycle=1`, founderCookie);
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json() as {
      rows: Array<{ employeeId: string; paidTotal: number | null; pendingPayoutTotal: number | null }>;
    };
    const row = body.rows.find((item) => item.employeeId === SEEDED_EMPLOYEE_IDS.ivan);
    assert.ok(row, 'Assigned Employee must have a payroll row, even without attendance');
    return row;
  };
  return { prisma, baseUrl, accounts, owners, cookies, founder, founderCookie, order, request, payout, payroll };
}

test('PAY-01/02/03/05: pending payouts preserve official money, own scope and one approval effect', async (t) => {
  const f = await financeFixture(t);
  const first = await f.payout(0, 500);
  const second = await f.payout(1, 300);
  assert.equal(first.status, 'draft');
  assert.equal(second.status, 'draft');
  const initial = await f.payroll();
  assert.equal(initial.paidTotal, 0);
  assert.equal(initial.pendingPayoutTotal, 800);

  const ownView = await f.request(`/accountability/orders/${f.order.id}`, f.cookies[0]);
  assert.equal(ownView.status, 200);
  const own = await ownView.json() as {
    visibilityScope: string;
    accounts: Array<{ user: { id: string }; expenses: Array<{ id: string }>; summary: { currentBalance: number } }>;
  };
  assert.equal(own.visibilityScope, 'own');
  assert.deepEqual(own.accounts.map((account) => account.user.id), [f.owners[0].id]);
  assert.deepEqual(own.accounts[0].expenses.map((expense) => expense.id), [first.id]);
  assert.equal(own.accounts[0].summary.currentBalance, 2000);
  const foreignSubmit = await f.request(`/accountability/me/expenses/${first.id}/submit`, f.cookies[1], {});
  assert.equal(foreignSubmit.status, 403);
  assert.equal((await f.prisma.accountabilityExpense.findUniqueOrThrow({ where: { id: first.id } })).status, 'draft');

  // Employee payouts may be submitted without a photo; independent review still applies.
  const submitted = await f.request(`/accountability/me/expenses/${first.id}/submit`, f.cookies[0], {});
  assert.equal(submitted.status, 200, await submitted.clone().text());
  const beforeApproval = await f.payroll();
  assert.equal(beforeApproval.paidTotal, 0);
  assert.equal(beforeApproval.pendingPayoutTotal, 800);
  const responses = await Promise.all([0, 1].map(() => f.request(
    `/accountability/expenses/${first.id}/approve`, f.founderCookie, {},
  )));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const stored = await f.prisma.accountabilityExpense.findUniqueOrThrow({ where: { id: first.id } });
  assert.equal(stored.status, 'approved');
  assert.equal(stored.approvedByUserId, f.founder.id);
  assert.equal(stored.accountabilityAccountId, f.accounts[0].id);
  assert.equal(stored.employeeId, SEEDED_EMPLOYEE_IDS.ivan);
  assert.equal(stored.oneTimeOrderWorkCycle, 1);
  assert.equal(stored.expenseDate?.toISOString().slice(0, 10), '2026-10-01');
  const row = await f.payroll();
  assert.equal(row.paidTotal, 500);
  assert.equal(row.pendingPayoutTotal, 300);
  const finalView = await f.request(`/accountability/orders/${f.order.id}`, f.cookies[0]);
  assert.equal(finalView.status, 200);
  const final = await finalView.json() as { accounts: Array<{ summary: { currentBalance: number } }> };
  assert.equal(final.accounts[0].summary.currentBalance, 1500);
  assert.equal(await f.prisma.auditEvent.count({ where: {
    entityType: 'accountability_expense', entityId: first.id, action: 'accountability_expense_approved',
  } }), 1);
  const beforeReads = await f.prisma.accountabilityExpense.findMany({
    where: { oneTimeOrderId: f.order.id }, orderBy: { id: 'asc' },
  });
  await f.payroll();
  await f.payroll();
  assert.deepEqual(await f.prisma.accountabilityExpense.findMany({
    where: { oneTimeOrderId: f.order.id }, orderBy: { id: 'asc' },
  }), beforeReads, 'Read-only payroll must not create or rewrite financial facts');
});

test('PAY-04: an owner with approval authority still cannot approve their own payout', async (t) => {
  const f = await financeFixture(t);
  const payout = await f.payout(0, 500);
  const submitted = await f.request(`/accountability/me/expenses/${payout.id}/submit`, f.cookies[0], {});
  assert.equal(submitted.status, 200, await submitted.clone().text());
  // A real approval permission prevents a false-positive caused merely by missing authority.
  // This is isolated fixture setup, not an invented future admin HTTP contract.
  const permission = await f.prisma.permission.findUniqueOrThrow({ where: { code: 'expense.approve' } });
  await f.prisma.userPermission.create({ data: { userId: f.owners[0].id, permissionId: permission.id } });
  const privilegedCookie = await loginAndGetCookieHeader({
    baseUrl: f.baseUrl,
    login: f.owners[0].login, password: 'manager123',
  });
  const colleaguePayout = await f.payout(1, 100);
  assert.equal((await f.request(
    `/accountability/me/expenses/${colleaguePayout.id}/submit`, f.cookies[1], {},
  )).status, 200);
  const otherApproval = await f.request(
    `/accountability/expenses/${colleaguePayout.id}/approve`, privilegedCookie, {},
  );
  assert.equal(otherApproval.status, 200, await otherApproval.clone().text());
  const before = await f.prisma.accountabilityExpense.findUniqueOrThrow({ where: { id: payout.id } });
  const denied = await f.request(`/accountability/expenses/${payout.id}/approve`, privilegedCookie, {});
  assert.equal(denied.status, 403, await denied.clone().text());
  assert.deepEqual(await f.prisma.accountabilityExpense.findUniqueOrThrow({ where: { id: payout.id } }), before);
  assert.equal(await f.prisma.auditEvent.count({ where: {
    entityType: 'accountability_expense', entityId: payout.id, action: 'accountability_expense_approved',
  } }), 0);
});
