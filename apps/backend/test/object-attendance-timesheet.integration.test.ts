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

test('attendance sync keeps manual timesheet correction stable when fact is later removed', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const founderCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'founder',
    password: 'founder123',
  });
  const targetDate = getSafeBusinessDate(25);
  const { objectId } = await createCoreTestObject(prisma);

  t.after(async () => {
    await cleanupCoreTestObject(prisma, objectId);
    await app.close();
    await prisma.$disconnect();
  });

  const attendanceResponse = await fetch(
    `${baseUrl}/api/v1/objects/${objectId}/attendance`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operationDate: targetDate.operationDate,
        employeeIds: [SEEDED_EMPLOYEE_IDS.ivan],
      }),
    },
  );

  assert.equal(attendanceResponse.status, 201);

  const timesheetAfterAttendance = await fetch(
    `${baseUrl}/api/v1/timesheets?objectId=${objectId}&year=${targetDate.year}&month=${targetDate.month}`,
    {
      headers: {
        Cookie: founderCookie,
      },
    },
  );

  assert.equal(timesheetAfterAttendance.status, 200);

  const initialTimesheet = (await timesheetAfterAttendance.json()) as {
    objectDailyRate: number;
    rows: Array<{
      employeeId: string;
      entries: Array<{
        dayOfMonth: number;
        dayValue: number;
        isChangedManually: boolean;
        hasFact: boolean;
      }>;
    }>;
  };

  const initialEntry = initialTimesheet.rows
    .find((row) => row.employeeId === SEEDED_EMPLOYEE_IDS.ivan)
    ?.entries.find((entry) => entry.dayOfMonth === targetDate.dayOfMonth);

  assert.ok(initialEntry);
  assert.equal(initialEntry.dayValue, initialTimesheet.objectDailyRate);
  assert.equal(initialEntry.isChangedManually, false);
  assert.equal(initialEntry.hasFact, true);

  const correctionResponse = await fetch(`${baseUrl}/api/v1/timesheets/entries`, {
    method: 'POST',
    headers: {
      Cookie: founderCookie,
      'Content-Type': 'application/json',
    },
      body: JSON.stringify({
      objectId,
      year: targetDate.year,
      month: targetDate.month,
      employeeId: SEEDED_EMPLOYEE_IDS.ivan,
      dayOfMonth: targetDate.dayOfMonth,
      dayValue: initialTimesheet.objectDailyRate + 500,
      comment: 'Manual override must survive attendance removal',
    }),
  });

  assert.equal(correctionResponse.status, 201);

  const removeAttendanceResponse = await fetch(
    `${baseUrl}/api/v1/objects/${objectId}/attendance`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operationDate: targetDate.operationDate,
        employeeIds: [],
      }),
    },
  );

  assert.equal(removeAttendanceResponse.status, 201);

  const timesheetAfterRemoval = await fetch(
    `${baseUrl}/api/v1/timesheets?objectId=${objectId}&year=${targetDate.year}&month=${targetDate.month}`,
    {
      headers: {
        Cookie: founderCookie,
      },
    },
  );

  assert.equal(timesheetAfterRemoval.status, 200);

  const finalTimesheet = (await timesheetAfterRemoval.json()) as {
    rows: Array<{
      employeeId: string;
      entries: Array<{
        dayOfMonth: number;
        dayValue: number;
        comment: string | null;
        isChangedManually: boolean;
        hasFact: boolean;
      }>;
    }>;
  };

  const finalEntry = finalTimesheet.rows
    .find((row) => row.employeeId === SEEDED_EMPLOYEE_IDS.ivan)
    ?.entries.find((entry) => entry.dayOfMonth === targetDate.dayOfMonth);

  assert.ok(finalEntry);
  assert.equal(finalEntry.dayValue, initialTimesheet.objectDailyRate + 500);
  assert.equal(finalEntry.comment, 'Manual override must survive attendance removal');
  assert.equal(finalEntry.isChangedManually, true);
  assert.equal(finalEntry.hasFact, false);
});
