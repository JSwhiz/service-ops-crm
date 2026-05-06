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

test('timesheet rate policies calculate auto/final/deviation fields and export xlsx', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const founderCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'founder',
    password: 'founder123',
  });
  const partialDate = getSafeBusinessDate(10);
  const agreedDate = getSafeBusinessDate(11);
  const { objectId } = await createCoreTestObject(prisma);

  t.after(async () => {
    await cleanupCoreTestObject(prisma, objectId);
    await app.close();
    await prisma.$disconnect();
  });

  const updatePartialPolicyResponse = await fetch(
    `${baseUrl}/api/v1/objects/${objectId}/employees/${SEEDED_EMPLOYEE_IDS.ivan}/rate-policy`,
    {
      method: 'PUT',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ratePolicyType: 'partial_shift',
        baseAmount: 1600,
        standardShiftHours: 8,
      }),
    },
  );
  assert.equal(updatePartialPolicyResponse.status, 200);

  const updateMonthlyPolicyResponse = await fetch(
    `${baseUrl}/api/v1/objects/${objectId}/employees/${SEEDED_EMPLOYEE_IDS.sergey}/rate-policy`,
    {
      method: 'PUT',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ratePolicyType: 'monthly_fixed',
        baseAmount: 10000,
        scheduleCode: '5/2',
      }),
    },
  );
  assert.equal(updateMonthlyPolicyResponse.status, 200);

  const updateAgreedPolicyResponse = await fetch(
    `${baseUrl}/api/v1/objects/${objectId}/employees/${SEEDED_EMPLOYEE_IDS.alexey}/rate-policy`,
    {
      method: 'PUT',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ratePolicyType: 'agreed_substitution_rate',
        baseAmount: 3100,
        notes: 'Integration agreed substitution rate',
      }),
    },
  );
  assert.equal(updateAgreedPolicyResponse.status, 200);

  const partialAttendanceResponse = await fetch(
    `${baseUrl}/api/v1/objects/${objectId}/attendance`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operationDate: partialDate.operationDate,
        employeeIds: [SEEDED_EMPLOYEE_IDS.ivan],
        employeeFacts: [
          {
            employeeId: SEEDED_EMPLOYEE_IDS.ivan,
            workedHours: 3,
          },
        ],
      }),
    },
  );
  assert.equal(partialAttendanceResponse.status, 201);

  const agreedAttendanceResponse = await fetch(
    `${baseUrl}/api/v1/objects/${objectId}/attendance`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        operationDate: agreedDate.operationDate,
        employeeIds: [SEEDED_EMPLOYEE_IDS.alexey],
      }),
    },
  );
  assert.equal(agreedAttendanceResponse.status, 201);

  const timesheetResponse = await fetch(
    `${baseUrl}/api/v1/timesheets?objectId=${objectId}&year=${partialDate.year}&month=${partialDate.month}`,
    {
      headers: {
        Cookie: founderCookie,
      },
    },
  );
  assert.equal(timesheetResponse.status, 200);

  const timesheet = (await timesheetResponse.json()) as {
    rows: Array<{
      employeeId: string;
      rowTotal: number;
      ratePolicy: {
        ratePolicyType: string;
      };
      entries: Array<{
        dayOfMonth: number;
        autoValue: number;
        finalValue: number;
        dayValue: number;
        difference: number;
        workedHours: number | null;
        calculationExplanation: string | null;
      }>;
    }>;
  };

  const partialEntry = timesheet.rows
    .find((row) => row.employeeId === SEEDED_EMPLOYEE_IDS.ivan)
    ?.entries.find((entry) => entry.dayOfMonth === partialDate.dayOfMonth);
  assert.ok(partialEntry);
  assert.equal(partialEntry.autoValue, 600);
  assert.equal(partialEntry.finalValue, 600);
  assert.equal(partialEntry.workedHours, 3);

  const monthlyRow = timesheet.rows.find(
    (row) => row.employeeId === SEEDED_EMPLOYEE_IDS.sergey,
  );
  assert.ok(monthlyRow);
  assert.equal(monthlyRow.ratePolicy.ratePolicyType, 'monthly_fixed');
  assert.equal(monthlyRow.rowTotal, 10000);

  const agreedEntry = timesheet.rows
    .find((row) => row.employeeId === SEEDED_EMPLOYEE_IDS.alexey)
    ?.entries.find((entry) => entry.dayOfMonth === agreedDate.dayOfMonth);
  assert.ok(agreedEntry);
  assert.equal(agreedEntry.autoValue, 3100);
  assert.match(agreedEntry.calculationExplanation ?? '', /Договорная ставка/);

  const missingCommentCorrection = await fetch(
    `${baseUrl}/api/v1/timesheets/entries`,
    {
      method: 'POST',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        objectId,
        year: partialDate.year,
        month: partialDate.month,
        employeeId: SEEDED_EMPLOYEE_IDS.ivan,
        dayOfMonth: partialDate.dayOfMonth,
        dayValue: partialEntry.autoValue + 100,
      }),
    },
  );
  assert.equal(missingCommentCorrection.status, 400);

  const exportResponse = await fetch(
    `${baseUrl}/api/v1/timesheets/export?objectId=${objectId}&year=${partialDate.year}&month=${partialDate.month}`,
    {
      headers: {
        Cookie: founderCookie,
      },
    },
  );
  assert.equal(exportResponse.status, 200);
  assert.match(
    exportResponse.headers.get('content-type') ?? '',
    /spreadsheetml\.sheet/,
  );

  const exported = Buffer.from(await exportResponse.arrayBuffer());
  assert.equal(exported.subarray(0, 2).toString('utf8'), 'PK');
  assert.ok(exported.length > 1000);
});
