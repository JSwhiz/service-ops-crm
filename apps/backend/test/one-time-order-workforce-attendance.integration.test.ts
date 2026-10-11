import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { SEEDED_EMPLOYEE_IDS } from './helpers/core-fixtures';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('one-time workforce attendance is scoped, correctable with audit, and reflected in export', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const [founder, assignedManager] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
  ]);
  const [founderCookie, managerCookie, unrelatedManagerCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager2', password: 'manager123' }),
  ]);
  const order = await prisma.oneTimeOrder.create({
    data: {
      title: `Attendance audit ${Date.now()}`,
      executionAddress: 'Test address',
      status: 'in_progress',
      executionStartDate: new Date('2026-10-01T00:00:00.000Z'),
      executionEndDate: new Date('2026-10-03T00:00:00.000Z'),
      contactName: 'Test contact',
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
  const existingAccount = await prisma.accountabilityAccount.findUnique({
    where: { userId: assignedManager.id },
    select: { id: true, status: true },
  });
  const unrelatedManager = await prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } });
  const existingUnrelatedAccount = await prisma.accountabilityAccount.findUnique({
    where: { userId: unrelatedManager.id },
    select: { id: true },
  });
  const accountabilityAccount = existingAccount ?? await prisma.accountabilityAccount.create({
    data: { userId: assignedManager.id, status: 'active' },
    select: { id: true, status: true },
  });
  const unrelatedAccount = existingUnrelatedAccount ?? await prisma.accountabilityAccount.create({
    data: { userId: unrelatedManager.id, status: 'active' },
    select: { id: true },
  });
  const createdAccount = !existingAccount;
  const createdUnrelatedAccount = !existingUnrelatedAccount;
  assert.equal(accountabilityAccount.status, 'active');
  let payoutExpenseId: string | null = null;

  t.after(async () => {
    if (usesIsolatedIntegrationDatabase()) {
      await app.close();
      await prisma.$disconnect();
      return;
    }
    if (payoutExpenseId) {
      await prisma.auditEvent.deleteMany({
        where: { entityType: 'accountability_expense', entityId: payoutExpenseId },
      });
      await prisma.accountabilityExpense.delete({ where: { id: payoutExpenseId } });
    }
    if (createdAccount) {
      await prisma.accountabilityAccount.delete({ where: { id: accountabilityAccount.id } });
    }
    if (createdUnrelatedAccount) {
      await prisma.accountabilityAccount.delete({ where: { id: unrelatedAccount.id } });
    }
    await prisma.$executeRaw`DELETE FROM "one_time_order_timesheet_day_entries" WHERE "oneTimeOrderId" = ${order.id}`;
    await prisma.$executeRaw`DELETE FROM "one_time_order_attendance_submissions" WHERE "oneTimeOrderId" = ${order.id}`;
    await prisma.$executeRaw`DELETE FROM "one_time_order_employee_assignments" WHERE "oneTimeOrderId" = ${order.id}`;
    await prisma.oneTimeOrder.delete({ where: { id: order.id } });
    await app.close();
    await prisma.$disconnect();
  });

  const basePath = `${baseUrl}/api/v1/one-time-orders/${order.id}/workforce`;
  const addEmployeeResponse = await fetch(`${basePath}/employees`, {
    method: 'POST',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ employeeId: SEEDED_EMPLOYEE_IDS.ivan }),
  });
  assert.equal(addEmployeeResponse.status, 201);
  // The cleaner was assigned before the historical dates being tested.
  await prisma.$executeRaw`
    UPDATE "one_time_order_employee_assignments"
    SET "assignedAt" = '2026-09-30T00:00:00.000Z'::TIMESTAMPTZ
    WHERE "oneTimeOrderId" = ${order.id}
      AND "employeeId" = ${SEEDED_EMPLOYEE_IDS.ivan}
      AND "workCycle" = 1
  `;

  const deniedResponse = await fetch(`${basePath}/attendance/today?date=2026-10-01`, {
    headers: { Cookie: unrelatedManagerCookie },
  });
  assert.equal(deniedResponse.status, 403);

  const initialCoverageResponse = await fetch(`${basePath}/attendance/coverage`, {
    headers: { Cookie: managerCookie },
  });
  assert.equal(initialCoverageResponse.status, 200);
  const initialCoverage = await initialCoverageResponse.json() as { missingDates: string[] };
  assert.deepEqual(initialCoverage.missingDates, ['2026-10-01', '2026-10-02', '2026-10-03']);

  const initialSubmissionResponse = await fetch(`${basePath}/attendance/today`, {
    method: 'POST',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationDate: '2026-10-01', employeeIds: [] }),
  });
  assert.equal(initialSubmissionResponse.status, 201, await initialSubmissionResponse.clone().text());

  const unreasonedCorrectionResponse = await fetch(`${basePath}/attendance/today`, {
    method: 'POST',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationDate: '2026-10-01', employeeIds: [SEEDED_EMPLOYEE_IDS.ivan] }),
  });
  assert.equal(unreasonedCorrectionResponse.status, 400);

  const correctionResponse = await fetch(`${basePath}/attendance/today`, {
    method: 'POST',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operationDate: '2026-10-01',
      employeeIds: [SEEDED_EMPLOYEE_IDS.ivan],
      correctionReason: 'Employee confirmed the missed attendance mark',
    }),
  });
  assert.equal(correctionResponse.status, 201, await correctionResponse.clone().text());

  const coverageAfterCorrectionResponse = await fetch(`${basePath}/attendance/coverage`, {
    headers: { Cookie: managerCookie },
  });
  const coverageAfterCorrection = await coverageAfterCorrectionResponse.json() as {
    missingDates: string[];
    history: Array<{ action: string; reason: string | null; actor: string }>;
  };
  assert.deepEqual(coverageAfterCorrection.missingDates, ['2026-10-02', '2026-10-03']);
  assert.equal(coverageAfterCorrection.history[0]?.action, 'one_time_order.attendance.corrected');
  assert.equal(coverageAfterCorrection.history[0]?.reason, 'Employee confirmed the missed attendance mark');
  assert.equal(coverageAfterCorrection.history[0]?.actor, assignedManager.fullName);

  const timesheetResponse = await fetch(`${basePath}/timesheet?workCycle=1`, {
    headers: { Cookie: managerCookie },
  });
  assert.equal(timesheetResponse.status, 200);
  const timesheet = await timesheetResponse.json() as {
    rows: Array<{ employeeId: string; total: number; days: Array<{ operationDate: string; present: boolean }> }>;
  };
  const employeeRow = timesheet.rows.find((row) => row.employeeId === SEEDED_EMPLOYEE_IDS.ivan);
  assert.ok(employeeRow);
  assert.equal(employeeRow.days.find((day) => day.operationDate === '2026-10-01')?.present, true);
  assert.ok(employeeRow.total > 0);

  const payoutResponse = await fetch(`${baseUrl}/api/v1/accountability/me/expenses`, {
    method: 'POST',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: 500,
      description: 'Фактическая выплата уборщице по заказу',
      oneTimeOrderId: order.id,
      oneTimeOrderWorkCycle: 1,
      employeeId: SEEDED_EMPLOYEE_IDS.ivan,
      expenseCategory: 'employee_payout',
      expenseDate: '2026-10-01',
    }),
  });
  assert.equal(payoutResponse.status, 201, await payoutResponse.clone().text());
  const payout = await payoutResponse.json() as {
    id: string;
    employeeId: string;
    employeeFullName: string;
    oneTimeOrderWorkCycle: number;
    status: string;
  };
  payoutExpenseId = payout.id;
  assert.equal(payout.employeeId, SEEDED_EMPLOYEE_IDS.ivan);
  assert.ok(payout.employeeFullName);
  assert.equal(payout.oneTimeOrderWorkCycle, 1);
  assert.equal(payout.status, 'draft');
  const storedPayout = await prisma.accountabilityExpense.findUniqueOrThrow({
    where: { id: payout.id },
    select: { accountabilityAccountId: true },
  });
  assert.equal(storedPayout.accountabilityAccountId, accountabilityAccount.id);

  const managerAccountabilityResponse = await fetch(
    `${baseUrl}/api/v1/accountability/orders/${order.id}`,
    { headers: { Cookie: managerCookie } },
  );
  assert.equal(managerAccountabilityResponse.status, 200);
  const managerAccountability = await managerAccountabilityResponse.json() as {
    capabilities: { canCreateEmployeePayout: boolean };
  };
  assert.equal(managerAccountability.capabilities.canCreateEmployeePayout, true);

  const reviewerAccountabilityResponse = await fetch(
    `${baseUrl}/api/v1/accountability/orders/${order.id}`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(reviewerAccountabilityResponse.status, 200);
  const reviewerAccountability = await reviewerAccountabilityResponse.json() as {
    capabilities: { canCreateEmployeePayout: boolean };
  };
  assert.equal(reviewerAccountability.capabilities.canCreateEmployeePayout, false);

  const unrelatedPayoutResponse = await fetch(`${baseUrl}/api/v1/accountability/me/expenses`, {
    method: 'POST',
    headers: { Cookie: unrelatedManagerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: 200,
      description: 'Попытка выплаты не назначенным менеджером',
      oneTimeOrderId: order.id,
      oneTimeOrderWorkCycle: 1,
      employeeId: SEEDED_EMPLOYEE_IDS.ivan,
      expenseCategory: 'employee_payout',
      expenseDate: '2026-10-01',
    }),
  });
  assert.equal(unrelatedPayoutResponse.status, 403);
  assert.equal(
    await prisma.accountabilityExpense.count({
      where: { accountabilityAccountId: unrelatedAccount.id, oneTimeOrderId: order.id },
    }),
    0,
  );

  const payrollTimesheetResponse = await fetch(`${basePath}/timesheet?month=2026-10&workCycle=1`, {
    headers: { Cookie: managerCookie },
  });
  assert.equal(payrollTimesheetResponse.status, 200);
  const payrollTimesheet = await payrollTimesheetResponse.json() as {
    rows: Array<{ employeeId: string; paidTotal: number | null; pendingPayoutTotal: number | null }>;
  };
  const payrollRow = payrollTimesheet.rows.find((row) => row.employeeId === SEEDED_EMPLOYEE_IDS.ivan);
  assert.equal(payrollRow?.paidTotal, 0);
  assert.equal(payrollRow?.pendingPayoutTotal, 500);

  if (usesIsolatedIntegrationDatabase()) {
    const uploadForm = new FormData();
    uploadForm.set('entityType', 'accountability_expense');
    uploadForm.set('entityId', payout.id);
    uploadForm.set('file', new Blob(['cleaner payout receipt'], { type: 'text/plain' }), 'payout.txt');
    const uploadResponse = await fetch(`${baseUrl}/api/v1/files/upload`, {
      method: 'POST',
      headers: { Cookie: managerCookie },
      body: uploadForm,
    });
    assert.equal(uploadResponse.status, 201, await uploadResponse.clone().text());
    const submitPayoutResponse = await fetch(`${baseUrl}/api/v1/accountability/me/expenses/${payout.id}/submit`, {
      method: 'POST',
      headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(submitPayoutResponse.status, 200);
    const approvePayoutResponse = await fetch(`${baseUrl}/api/v1/accountability/expenses/${payout.id}/approve`, {
      method: 'POST',
      headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(approvePayoutResponse.status, 200);
    const approvedTimesheetResponse = await fetch(`${basePath}/timesheet?month=2026-10&workCycle=1`, {
      headers: { Cookie: managerCookie },
    });
    const approvedTimesheet = await approvedTimesheetResponse.json() as {
      rows: Array<{ employeeId: string; paidTotal: number | null; pendingPayoutTotal: number | null }>;
    };
    const approvedPayrollRow = approvedTimesheet.rows.find((row) => row.employeeId === SEEDED_EMPLOYEE_IDS.ivan);
    assert.equal(approvedPayrollRow?.paidTotal, 500);
    assert.equal(approvedPayrollRow?.pendingPayoutTotal, 0);
  }

  const invalidEmployeePayoutResponse = await fetch(`${baseUrl}/api/v1/accountability/me/expenses`, {
    method: 'POST',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: 10,
      description: 'Несуществующее назначение',
      oneTimeOrderId: order.id,
      oneTimeOrderWorkCycle: 1,
      employeeId: SEEDED_EMPLOYEE_IDS.sergey,
      expenseCategory: 'employee_payout',
      expenseDate: '2026-10-01',
    }),
  });
  assert.equal(invalidEmployeePayoutResponse.status, 400);

  const exportResponse = await fetch(`${basePath}/timesheet/export.xlsx?workCycle=1&employeeId=${SEEDED_EMPLOYEE_IDS.ivan}`, {
    headers: { Cookie: managerCookie },
  });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type') ?? '', /spreadsheetml/);
  assert.ok((await exportResponse.arrayBuffer()).byteLength > 100);
  assert.ok(accountabilityAccount.id);
});
