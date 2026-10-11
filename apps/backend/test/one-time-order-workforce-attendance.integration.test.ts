import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { SEEDED_EMPLOYEE_IDS } from './helpers/core-fixtures';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('one-time workforce attendance is scoped, correctable with audit, and reflected in export', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const [founder, assignedManager] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
  ]);
  const [managerCookie, unrelatedManagerCookie] = await Promise.all([
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

  t.after(async () => {
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

  const exportResponse = await fetch(`${basePath}/timesheet/export.xlsx?workCycle=1&employeeId=${SEEDED_EMPLOYEE_IDS.ivan}`, {
    headers: { Cookie: managerCookie },
  });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type') ?? '', /spreadsheetml/);
  assert.ok((await exportResponse.arrayBuffer()).byteLength > 100);
});
