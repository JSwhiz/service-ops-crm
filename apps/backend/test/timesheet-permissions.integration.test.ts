import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import {
  SEEDED_EMPLOYEE_IDS,
  cleanupCoreTestObject,
  createCoreTestObject,
  getSafeBusinessDate,
} from './helpers/core-fixtures';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { approvePendingFinancialChange } from './helpers/approve-financial-change';
import type { TimesheetResponseDto } from '../src/modules/timesheets/dto/timesheet-response.dto';

test('timesheet read access does not grant manual correction by itself', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const [managerCookie, founderCookie, directorCookie] = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: 'manager1',
      password: 'manager123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: 'founder',
      password: 'founder123',
    }),
    loginAndGetCookieHeader({ baseUrl, login: 'director', password: 'director123' }),
  ]);
  // Day 1 stays inside the editable month. After the first day its correction
  // requires independent approval; on the first day the same-day path applies.
  const targetDate = getSafeBusinessDate(1);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const historical = targetDate.operationDate < today;
  const { objectId } = await createCoreTestObject(prisma, {
    includeManagerAssignment: true,
  });

  t.after(async () => {
    await cleanupCoreTestObject(prisma, objectId);
    await app.close();
    await prisma.$disconnect();
  });

  const managerReadResponse = await fetch(
    `${baseUrl}/api/v1/timesheets?objectId=${objectId}&year=${targetDate.year}&month=${targetDate.month}`,
    {
      headers: {
        Cookie: managerCookie,
      },
    },
  );

  assert.equal(managerReadResponse.status, 200);

  const managerTimesheet = (await managerReadResponse.json()) as {
    capabilities: {
      canManualCorrection: boolean;
    };
  };

  assert.equal(managerTimesheet.capabilities.canManualCorrection, false);
  assert.equal(await prisma.timesheetMonth.count({ where: { objectId } }), 0, 'GET must not create a financial container');

  const [founder, director, employee] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'director' } }),
    prisma.employee.findUniqueOrThrow({ where: { id: SEEDED_EMPLOYEE_IDS.sergey } }),
  ]);
  const month = await prisma.timesheetMonth.create({ data: {
    objectId, year: targetDate.year, month: targetDate.month, createdByUserId: founder.id,
  } });
  const row = await prisma.timesheetEmployeeRow.create({ data: {
    timesheetMonthId: month.id, employeeId: employee.id, employeeNameSnapshot: employee.fullName,
  } });
  const baseline = await prisma.timesheetDayEntry.create({ data: {
    rowId: row.id, dayOfMonth: targetDate.dayOfMonth, autoValue: 0, dayValue: 0, createdByUserId: founder.id,
  } });

  const managerCorrectionResponse = await fetch(
    `${baseUrl}/api/v1/timesheets/entries`,
    {
      method: 'POST',
      headers: {
        Cookie: managerCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        objectId,
        year: targetDate.year,
        month: targetDate.month,
        employeeId: SEEDED_EMPLOYEE_IDS.sergey,
        dayOfMonth: targetDate.dayOfMonth,
        dayValue: 1300,
        comment: 'Manager should not be able to correct timesheet manually',
      }),
    },
  );

  assert.equal(managerCorrectionResponse.status, 403);
  assert.deepEqual(await prisma.timesheetDayEntry.findUniqueOrThrow({ where: { id: baseline.id } }), baseline);

  const founderCorrectionResponse = await fetch(
    `${baseUrl}/api/v1/timesheets/entries`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        objectId,
        year: targetDate.year,
        month: targetDate.month,
        employeeId: SEEDED_EMPLOYEE_IDS.sergey,
        dayOfMonth: targetDate.dayOfMonth,
        dayValue: 1300,
        comment: 'Founder manual correction smoke',
      }),
    },
  );

  assert.equal(founderCorrectionResponse.status, 201);
  if (historical) {
    const pending = await founderCorrectionResponse.clone().json() as {
      id: string; sourceEntityId: string; status: string;
      payloadSnapshot: { currentDayValue: number; requestedDayValue: number; independentLeadershipRequired: boolean };
    };
    assert.equal(pending.status, 'pending');
    assert.deepEqual([pending.payloadSnapshot.currentDayValue, pending.payloadSnapshot.requestedDayValue], [0, 1300]);
    assert.equal(pending.payloadSnapshot.independentLeadershipRequired, true);
    assert.deepEqual(await prisma.timesheetDayEntry.findUniqueOrThrow({ where: { id: baseline.id } }), baseline);
    const pendingException = await prisma.timesheetManualException.findUniqueOrThrow({ where: { id: pending.sourceEntityId } });
    assert.equal(pendingException.status, 'pending');
    assert.equal(pendingException.currentDayValueSnapshot, 0);
    assert.equal(pendingException.requestedDayValue, 1300);
    for (const actor of [founderCookie, managerCookie]) {
      const denied = await fetch(`${baseUrl}/api/v1/approvals/${pending.id}/approve`, {
        method: 'POST', headers: { Cookie: actor, 'Content-Type': 'application/json' }, body: JSON.stringify({}),
      });
      assert.equal(denied.status, 403);
      assert.deepEqual(await prisma.timesheetDayEntry.findUniqueOrThrow({ where: { id: baseline.id } }), baseline);
      assert.equal((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: pending.id } })).status, 'pending');
    }
    await approvePendingFinancialChange(founderCorrectionResponse, baseUrl, directorCookie);
    const approved = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: pending.id } });
    assert.equal(approved.status, 'approved');
    assert.equal(approved.createdByUserId, founder.id);
    assert.equal(approved.resolvedByUserId, director.id);
    const exception = await prisma.timesheetManualException.findUniqueOrThrow({ where: { id: pending.sourceEntityId } });
    assert.equal(exception.status, 'approved');
    assert.equal(exception.currentDayValueSnapshot, 0);
    assert.equal(exception.requestedDayValue, 1300);
    assert.equal(exception.resolvedByUserId, director.id);
  }
  const founderReadResponse = await fetch(
    `${baseUrl}/api/v1/timesheets?objectId=${objectId}&year=${targetDate.year}&month=${targetDate.month}`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(founderReadResponse.status, 200);
  const founderTimesheet = await founderReadResponse.json() as TimesheetResponseDto;

  assert.equal(founderTimesheet.capabilities.canManualCorrection, true);

  const correctedEntry = founderTimesheet.rows
    .find((row) => row.employeeId === SEEDED_EMPLOYEE_IDS.sergey)
    ?.entries.find((entry) => entry.dayOfMonth === targetDate.dayOfMonth);

  assert.ok(correctedEntry);
  assert.equal(correctedEntry.dayValue, 1300);
  assert.equal(correctedEntry.comment, 'Founder manual correction smoke');
  assert.equal(correctedEntry.isChangedManually, true);
  assert.equal(correctedEntry.autoValue, 0);
  assert.equal(correctedEntry.manualValue, 1300);
  assert.equal(correctedEntry.finalValue, 1300);
  assert.equal(correctedEntry.difference, 1300);
  assert.equal(founderTimesheet.monthTotal, 1300);
  assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId } }), 0, 'manual money must not manufacture attendance');
});
