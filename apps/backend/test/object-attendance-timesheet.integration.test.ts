import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import {
  SEEDED_OBJECT_ID,
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

test('object staffing and attendance surface active substitution and block unavailable employee selection', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const founderCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'founder',
    password: 'founder123',
  });
  const hrCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'hr1',
    password: 'hr123',
  });
  const targetDate = getSafeBusinessDate(new Date().getDate());
  const availabilityComment = `HR bridge unavailable ${Date.now()}`;
  const substitutionReason = `HR bridge substitution ${Date.now()}`;

  t.after(async () => {
    await prisma.employeeAvailabilityWindow.deleteMany({
      where: {
        comment: availabilityComment,
      },
    });
    await prisma.employeeSubstitution.deleteMany({
      where: {
        reason: substitutionReason,
      },
    });
    await app.close();
    await prisma.$disconnect();
  });

  const availabilityResponse = await fetch(
    `${baseUrl}/api/v1/employees/${SEEDED_EMPLOYEE_IDS.ivan}/availability`,
    {
      method: 'POST',
      headers: {
        Cookie: hrCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        startDate: targetDate.operationDate,
        endDate: targetDate.operationDate,
        availabilityMode: 'full_day',
        availabilityStatus: 'unavailable',
        comment: availabilityComment,
      }),
    },
  );

  assert.equal(availabilityResponse.status, 201);

  const substitutionResponse = await fetch(
    `${baseUrl}/api/v1/employees/${SEEDED_EMPLOYEE_IDS.ivan}/substitutions`,
    {
      method: 'POST',
      headers: {
        Cookie: hrCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        substituteEmployeeId: SEEDED_EMPLOYEE_IDS.alexey,
        objectId: SEEDED_OBJECT_ID,
        startDate: `${targetDate.operationDate}T09:00`,
        endDate: `${targetDate.operationDate}T18:00`,
        status: 'active',
        reason: substitutionReason,
        comment: 'Временная подмена на объекте',
      }),
    },
  );

  assert.equal(substitutionResponse.status, 201);

  const staffingResponse = await fetch(
    `${baseUrl}/api/v1/objects/${SEEDED_OBJECT_ID}/employees`,
    {
      headers: {
        Cookie: founderCookie,
      },
    },
  );

  assert.equal(staffingResponse.status, 200);

  const staffingEmployees = (await staffingResponse.json()) as Array<{
    id: string;
    availability: {
      isUnavailable: boolean;
      availabilityMode: string | null;
      comment: string | null;
    };
    activeSubstitutions: Array<{
      role: 'primary' | 'replacement';
      counterpartEmployeeId: string;
    }>;
  }>;

  const primaryEmployee = staffingEmployees.find(
    (item) => item.id === SEEDED_EMPLOYEE_IDS.ivan,
  );

  assert.ok(primaryEmployee);
  assert.equal(primaryEmployee.availability.isUnavailable, true);
  assert.equal(primaryEmployee.availability.availabilityMode, 'full_day');
  assert.equal(primaryEmployee.availability.comment, availabilityComment);
  assert.ok(
    primaryEmployee.activeSubstitutions.some(
      (item) =>
        item.role === 'primary' &&
        item.counterpartEmployeeId === SEEDED_EMPLOYEE_IDS.alexey,
    ),
  );

  const attendanceViewResponse = await fetch(
    `${baseUrl}/api/v1/objects/${SEEDED_OBJECT_ID}/attendance/today`,
    {
      headers: {
        Cookie: founderCookie,
      },
    },
  );

  assert.equal(attendanceViewResponse.status, 200);

  const attendanceView = (await attendanceViewResponse.json()) as {
    employees: Array<{
      id: string;
      isAssignedToObject: boolean;
      availability: {
        isUnavailable: boolean;
      };
      activeSubstitutions: Array<{
        role: 'primary' | 'replacement';
        counterpartEmployeeId: string;
      }>;
    }>;
  };

  assert.ok(
    attendanceView.employees.some(
      (employee) =>
        employee.id === SEEDED_EMPLOYEE_IDS.ivan &&
        employee.availability.isUnavailable,
    ),
  );
  assert.ok(
    attendanceView.employees.some(
      (employee) =>
        employee.id === SEEDED_EMPLOYEE_IDS.alexey &&
        employee.activeSubstitutions.some(
          (item) =>
            item.role === 'replacement' &&
            item.counterpartEmployeeId === SEEDED_EMPLOYEE_IDS.ivan,
        ),
    ),
  );

  const forbiddenAttendanceResponse = await fetch(
    `${baseUrl}/api/v1/objects/${SEEDED_OBJECT_ID}/attendance`,
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

  assert.equal(forbiddenAttendanceResponse.status, 403);
});
