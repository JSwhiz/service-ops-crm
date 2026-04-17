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

test('timesheet read access does not grant manual correction by itself', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const [managerCookie, founderCookie] = await Promise.all([
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
  ]);
  const targetDate = getSafeBusinessDate(26);
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

  const founderTimesheet = (await founderCorrectionResponse.json()) as {
    capabilities: {
      canManualCorrection: boolean;
    };
    rows: Array<{
      employeeId: string;
      entries: Array<{
        dayOfMonth: number;
        dayValue: number;
        comment: string | null;
        isChangedManually: boolean;
      }>;
    }>;
  };

  assert.equal(founderTimesheet.capabilities.canManualCorrection, true);

  const correctedEntry = founderTimesheet.rows
    .find((row) => row.employeeId === SEEDED_EMPLOYEE_IDS.sergey)
    ?.entries.find((entry) => entry.dayOfMonth === targetDate.dayOfMonth);

  assert.ok(correctedEntry);
  assert.equal(correctedEntry.dayValue, 1300);
  assert.equal(correctedEntry.comment, 'Founder manual correction smoke');
  assert.equal(correctedEntry.isChangedManually, true);
});
