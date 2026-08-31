import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import {
  SEEDED_EMPLOYEE_IDS,
  cleanupCoreTestObject,
  createCoreTestObject,
} from './helpers/core-fixtures';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface OverviewPayload {
  year: number;
  month: number;
  daysInMonth: number;
  rows: Array<{
    objectId: string;
    objectName: string;
    employeeId: string;
    advanceTotal: number;
    salaryTotal: number;
    monthTotal: number;
    employeeName: string;
    entries: Array<{
      dayOfMonth: number;
      finalValue: number;
      autoValue: number;
      manualValue: number | null;
      difference: number;
      isChangedManually: boolean;
      workedHours: number | null;
      ratePolicySnapshot: Record<string, unknown> | null;
      calculationExplanation: string | null;
    }>;
  }>;
  totals: { advanceTotal: number; salaryTotal: number; monthTotal: number };
  capabilities: { canManualCorrection: boolean };
}

async function api(
  baseUrl: string,
  cookie: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`${baseUrl}/api/v1${path}`, {
    ...init,
    headers: {
      Cookie: cookie,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
}

function comparableEntry(entry: OverviewPayload['rows'][number]['entries'][number] | undefined) {
  assert.ok(entry);

  return {
    dayOfMonth: entry.dayOfMonth,
    finalValue: entry.finalValue,
    autoValue: entry.autoValue,
    manualValue: entry.manualValue,
    difference: entry.difference,
    isChangedManually: entry.isChangedManually,
    workedHours: entry.workedHours,
    ratePolicySnapshot: entry.ratePolicySnapshot,
    calculationExplanation: entry.calculationExplanation,
  };
}

test('timesheet overview is bulk, access-safe, filterable and exportable', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const [deputyCookie, managerCookie, founderCookie] = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: 'gorbacheva',
      password: 'gorbacheva123',
    }),
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
  const first = await createCoreTestObject(prisma, {
    includeManagerAssignment: true,
  });
  const second = await createCoreTestObject(prisma);
  const untouched = await createCoreTestObject(prisma);
  const periodEmployeeIds: string[] = [];
  const year = 2028;
  const month = 2;

  t.after(async () => {
    await cleanupCoreTestObject(prisma, first.objectId);
    await cleanupCoreTestObject(prisma, second.objectId);
    await cleanupCoreTestObject(prisma, untouched.objectId);
    if (periodEmployeeIds.length > 0) {
      await prisma.employee.deleteMany({
        where: { id: { in: periodEmployeeIds } },
      });
    }
    await app.close();
    await prisma.$disconnect();
  });

  const firstObject = await prisma.object.findUniqueOrThrow({
    where: { id: first.objectId },
    select: { name: true },
  });
  const secondObject = await prisma.object.findUniqueOrThrow({
    where: { id: second.objectId },
    select: { name: true },
  });
  const founder = await prisma.user.findUniqueOrThrow({
    where: { login: 'founder' },
    select: { id: true },
  });

  await prisma.objectAttendanceFact.createMany({
    data: [
      [first.objectId, 12, 2500],
      [first.objectId, 15, 2500],
      [first.objectId, 16, 2500],
      [first.objectId, 22, 2500],
      [first.objectId, 29, 2500],
      [second.objectId, 20, 1800],
    ].map(([objectId, day, value]) => ({
      objectId: String(objectId),
      employeeId: SEEDED_EMPLOYEE_IDS.ivan,
      operationDate: new Date(Date.UTC(year, month - 1, Number(day))),
      dailyRateSnapshot: Number(value),
      createdByUserId: founder.id,
    })),
  });

  for (const objectId of [first.objectId, second.objectId]) {
    const response = await api(
      baseUrl,
      founderCookie,
      `/timesheets?objectId=${objectId}&year=${year}&month=${month}`,
    );
    assert.equal(response.status, 200);
  }

  for (const [dayOfMonth, dayValue] of [
    [12, 3100],
    [22, 3800],
  ] as const) {
    const correction = await api(baseUrl, founderCookie, '/timesheets/entries', {
      method: 'POST',
      body: JSON.stringify({
        objectId: first.objectId,
        employeeId: SEEDED_EMPLOYEE_IDS.ivan,
        year,
        month,
        dayOfMonth,
        dayValue,
        comment: `Manual correction day ${dayOfMonth}`,
      }),
    });
    assert.equal(correction.status, 201);
  }

  const objectTimesheetBeforeRateChange = (await (
    await api(
      baseUrl,
      founderCookie,
      `/timesheets?objectId=${first.objectId}&year=${year}&month=${month}`,
    )
  ).json()) as {
    advanceTotal: number;
    salaryTotal: number;
    monthTotal: number;
    rows: OverviewPayload['rows'];
  };
  assert.equal(objectTimesheetBeforeRateChange.advanceTotal, 5600);
  assert.equal(objectTimesheetBeforeRateChange.salaryTotal, 8800);
  assert.equal(objectTimesheetBeforeRateChange.monthTotal, 14400);

  await Promise.all([
    prisma.objectEmployeeAssignment.update({
      where: {
        objectId_employeeId: {
          objectId: first.objectId,
          employeeId: SEEDED_EMPLOYEE_IDS.ivan,
        },
      },
      data: {
        ratePolicyType: 'partial_shift',
        ratePolicyBaseAmount: 9000,
        ratePolicyStandardShiftHours: 8,
      },
    }),
    prisma.object.update({
      where: { id: first.objectId },
      data: { dailyRate: 9100 },
    }),
    prisma.employee.update({
      where: { id: SEEDED_EMPLOYEE_IDS.ivan },
      data: { baseDailyRate: 9200 },
    }),
  ]);

  const objectTimesheetAfterRateChange = (await (
    await api(
      baseUrl,
      founderCookie,
      `/timesheets?objectId=${first.objectId}&year=${year}&month=${month}`,
    )
  ).json()) as typeof objectTimesheetBeforeRateChange;
  const beforeRateChangeRow = objectTimesheetBeforeRateChange.rows.find(
    (row) => row.employeeId === SEEDED_EMPLOYEE_IDS.ivan,
  );
  const afterRateChangeRow = objectTimesheetAfterRateChange.rows.find(
    (row) => row.employeeId === SEEDED_EMPLOYEE_IDS.ivan,
  );
  assert.ok(beforeRateChangeRow);
  assert.ok(afterRateChangeRow);
  for (const dayOfMonth of [12, 15, 16, 22]) {
    assert.deepEqual(
      comparableEntry(
        afterRateChangeRow.entries.find(
          (entry) => entry.dayOfMonth === dayOfMonth,
        ),
      ),
      comparableEntry(
        beforeRateChangeRow.entries.find(
          (entry) => entry.dayOfMonth === dayOfMonth,
        ),
      ),
    );
  }
  assert.deepEqual(
    {
      advanceTotal: objectTimesheetAfterRateChange.advanceTotal,
      salaryTotal: objectTimesheetAfterRateChange.salaryTotal,
      monthTotal: objectTimesheetAfterRateChange.monthTotal,
    },
    {
      advanceTotal: objectTimesheetBeforeRateChange.advanceTotal,
      salaryTotal: objectTimesheetBeforeRateChange.salaryTotal,
      monthTotal: objectTimesheetBeforeRateChange.monthTotal,
    },
  );

  const createdPeriodEmployees = await Promise.all(
    [
      'Будущий сотрудник',
      'Завершённый сотрудник',
      'Пересекающий месяц сотрудник',
      'Сотрудник только с attendance',
    ].map((fullName) =>
      prisma.employee.create({
        data: { fullName, employmentStatus: 'active' },
        select: { id: true },
      }),
    ),
  );
  const futureEmployee = createdPeriodEmployees[0];
  const endedEmployee = createdPeriodEmployees[1];
  const overlappingEmployee = createdPeriodEmployees[2];
  const attendanceEmployee = createdPeriodEmployees[3];
  assert.ok(futureEmployee);
  assert.ok(endedEmployee);
  assert.ok(overlappingEmployee);
  assert.ok(attendanceEmployee);
  periodEmployeeIds.push(
    futureEmployee.id,
    endedEmployee.id,
    overlappingEmployee.id,
    attendanceEmployee.id,
  );
  await Promise.all([
    prisma.objectEmployeeAssignment.create({
      data: {
        objectId: untouched.objectId,
        employeeId: futureEmployee.id,
        isActive: true,
        startDate: new Date(Date.UTC(year, month, 1)),
      },
    }),
    prisma.objectEmployeeAssignment.create({
      data: {
        objectId: untouched.objectId,
        employeeId: endedEmployee.id,
        isActive: false,
        startDate: new Date(Date.UTC(year - 1, 0, 1)),
        endDate: new Date(Date.UTC(year - 1, 11, 31)),
      },
    }),
    prisma.employeeObjectAssignmentHistory.create({
      data: {
        objectId: untouched.objectId,
        employeeId: endedEmployee.id,
        startedAt: new Date(Date.UTC(year - 1, 0, 1)),
        endedAt: new Date(Date.UTC(year - 1, 11, 31)),
        createdByUserId: founder.id,
        closedByUserId: founder.id,
      },
    }),
    prisma.employeeObjectAssignmentHistory.create({
      data: {
        objectId: untouched.objectId,
        employeeId: overlappingEmployee.id,
        startedAt: new Date(Date.UTC(year, month - 1, 10)),
        endedAt: new Date(Date.UTC(year, month, 5)),
        createdByUserId: founder.id,
        closedByUserId: founder.id,
      },
    }),
    prisma.objectAttendanceFact.create({
      data: {
        objectId: untouched.objectId,
        employeeId: attendanceEmployee.id,
        operationDate: new Date(Date.UTC(year, month - 1, 18)),
        dailyRateSnapshot: 1700,
        createdByUserId: founder.id,
      },
    }),
  ]);

  await prisma.objectEmployeeAssignment.update({
    where: {
      objectId_employeeId: {
        objectId: second.objectId,
        employeeId: SEEDED_EMPLOYEE_IDS.ivan,
      },
    },
    data: { isActive: false },
  });
  const monthCountBefore = await prisma.timesheetMonth.count({
    where: {
      objectId: { in: [first.objectId, second.objectId, untouched.objectId] },
      year,
      month,
    },
  });

  const overviewResponse = await api(
    baseUrl,
    deputyCookie,
    `/timesheets/overview?year=${year}&month=${month}`,
  );
  assert.equal(overviewResponse.status, 200);
  const overview = (await overviewResponse.json()) as OverviewPayload;
  assert.equal(overview.daysInMonth, 29);
  assert.equal(overview.capabilities.canManualCorrection, false);
  assert.equal(
    overview.rows.filter(
      (row) =>
        row.employeeId === SEEDED_EMPLOYEE_IDS.ivan &&
        [first.objectId, second.objectId].includes(row.objectId),
    )
      .length,
    2,
  );
  const firstIvan = overview.rows.find(
    (row) =>
      row.objectId === first.objectId &&
      row.employeeId === SEEDED_EMPLOYEE_IDS.ivan,
  );
  assert.ok(firstIvan);
  assert.equal(firstIvan.advanceTotal, 5600);
  assert.equal(firstIvan.salaryTotal, 8800);
  assert.equal(firstIvan.monthTotal, 14400);
  assert.deepEqual(
    {
      advanceTotal: firstIvan.advanceTotal,
      salaryTotal: firstIvan.salaryTotal,
      monthTotal: firstIvan.monthTotal,
    },
    {
      advanceTotal: objectTimesheetAfterRateChange.advanceTotal,
      salaryTotal: objectTimesheetAfterRateChange.salaryTotal,
      monthTotal: objectTimesheetAfterRateChange.monthTotal,
    },
  );
  for (const dayOfMonth of [12, 15, 16, 22]) {
    assert.deepEqual(
      comparableEntry(
        firstIvan.entries.find((entry) => entry.dayOfMonth === dayOfMonth),
      ),
      comparableEntry(
        afterRateChangeRow.entries.find(
          (entry) => entry.dayOfMonth === dayOfMonth,
        ),
      ),
    );
  }
  assert.equal(
    firstIvan.entries.find((entry) => entry.dayOfMonth === 12)?.isChangedManually,
    true,
  );
  assert.equal(
    firstIvan.entries.find((entry) => entry.dayOfMonth === 22)?.isChangedManually,
    true,
  );
  assert.equal(
    overview.totals.advanceTotal + overview.totals.salaryTotal,
    overview.totals.monthTotal,
  );
  assert.equal(
    await prisma.timesheetMonth.count({
      where: {
        objectId: { in: [first.objectId, second.objectId, untouched.objectId] },
        year,
        month,
      },
    }),
    monthCountBefore,
  );
  assert.equal(
    overview.rows.some((row) => row.employeeId === futureEmployee.id),
    false,
  );
  assert.equal(
    overview.rows.some((row) => row.employeeId === endedEmployee.id),
    false,
  );
  assert.equal(
    overview.rows.some((row) => row.employeeId === overlappingEmployee.id),
    true,
  );
  assert.equal(
    overview.rows.some((row) => row.employeeId === attendanceEmployee.id),
    true,
  );

  const objectFiltered = (await (
    await api(
      baseUrl,
      deputyCookie,
      `/timesheets/overview?year=${year}&month=${month}&objectId=${first.objectId}`,
    )
  ).json()) as OverviewPayload;
  assert.ok(objectFiltered.rows.every((row) => row.objectId === first.objectId));
  assert.equal(objectFiltered.totals.monthTotal, firstIvan.monthTotal);

  const employeeFiltered = (await (
    await api(
      baseUrl,
      deputyCookie,
      `/timesheets/overview?year=${year}&month=${month}&employeeId=${SEEDED_EMPLOYEE_IDS.ivan}`,
    )
  ).json()) as OverviewPayload;
  assert.equal(
    employeeFiltered.rows.filter((row) =>
      [first.objectId, second.objectId].includes(row.objectId),
    ).length,
    2,
  );

  const combined = (await (
    await api(
      baseUrl,
      deputyCookie,
      `/timesheets/overview?year=${year}&month=${month}&objectId=${second.objectId}&employeeId=${SEEDED_EMPLOYEE_IDS.ivan}`,
    )
  ).json()) as OverviewPayload;
  assert.equal(combined.rows.length, 1);
  assert.equal(combined.rows[0]?.objectId, second.objectId);

  const managerOverview = (await (
    await api(baseUrl, managerCookie, `/timesheets/overview?year=${year}&month=${month}`)
  ).json()) as OverviewPayload;
  assert.ok(managerOverview.rows.some((row) => row.objectId === first.objectId));
  assert.ok(managerOverview.rows.every((row) => row.objectId !== second.objectId));
  assert.equal(
    (
      await api(
        baseUrl,
        managerCookie,
        `/timesheets/overview?year=${year}&month=${month}&objectId=${second.objectId}`,
      )
    ).status,
    403,
  );
  const hiddenObjectReference = await api(
    baseUrl,
    managerCookie,
    `/timesheets/overview/references/objects?selectedId=${second.objectId}`,
  );
  assert.deepEqual(await hiddenObjectReference.json(), []);

  const objectSearch = await api(
    baseUrl,
    deputyCookie,
    `/timesheets/overview/references/objects?q=${encodeURIComponent(firstObject.name)}`,
  );
  assert.ok(
    ((await objectSearch.json()) as Array<{ id: string }>).some(
      (item) => item.id === first.objectId,
    ),
  );

  const periodReferencesResponse = await api(
    baseUrl,
    deputyCookie,
    `/timesheets/overview/references/employees?year=${year}&month=${month}&objectId=${untouched.objectId}`,
  );
  assert.equal(periodReferencesResponse.status, 200);
  const periodReferenceIds = new Set(
    ((await periodReferencesResponse.json()) as Array<{ id: string }>).map(
      (item) => item.id,
    ),
  );
  assert.equal(periodReferenceIds.has(futureEmployee.id), false);
  assert.equal(periodReferenceIds.has(endedEmployee.id), false);
  assert.equal(periodReferenceIds.has(overlappingEmployee.id), true);
  assert.equal(periodReferenceIds.has(attendanceEmployee.id), true);
  const futureSelectedReference = await api(
    baseUrl,
    deputyCookie,
    `/timesheets/overview/references/employees?year=${year}&month=${month}&objectId=${untouched.objectId}&selectedId=${futureEmployee.id}`,
  );
  assert.deepEqual(await futureSelectedReference.json(), []);

  const references = await api(
    baseUrl,
    deputyCookie,
    `/timesheets/overview/references/employees?year=${year}&month=${month}&objectId=${second.objectId}&q=Иван`,
  );
  assert.equal(references.status, 200);
  assert.ok(
    ((await references.json()) as Array<{ id: string }>).some(
      (item) => item.id === SEEDED_EMPLOYEE_IDS.ivan,
    ),
  );

  const exportResponse = await api(
    baseUrl,
    deputyCookie,
    `/timesheets/overview/export?year=${year}&month=${month}&objectId=${first.objectId}&employeeId=${SEEDED_EMPLOYEE_IDS.ivan}`,
  );
  assert.equal(exportResponse.status, 200);
  assert.match(
    exportResponse.headers.get('content-type') ?? '',
    /spreadsheetml\.sheet/,
  );
  const workbook = Buffer.from(await exportResponse.arrayBuffer());
  const workbookText = workbook.toString('utf8');
  assert.equal(workbook.subarray(0, 2).toString('utf8'), 'PK');
  assert.ok(workbookText.indexOf('>29<') < workbookText.indexOf('Аванс'));
  assert.ok(workbookText.indexOf('Аванс') < workbookText.indexOf('ЗП'));
  assert.ok(workbookText.indexOf('ЗП') < workbookText.indexOf('Итого'));
  assert.match(workbookText, /ИТОГО/);
  for (const value of [
    firstIvan.advanceTotal,
    firstIvan.salaryTotal,
    firstIvan.monthTotal,
    ...[12, 15, 16, 22].map(
      (dayOfMonth) =>
        firstIvan.entries.find((entry) => entry.dayOfMonth === dayOfMonth)
          ?.finalValue ?? 0,
    ),
  ]) {
    assert.match(workbookText, new RegExp(`>${value}<`));
  }
  assert.match(workbookText, new RegExp(firstObject.name));
  assert.doesNotMatch(workbookText, new RegExp(secondObject.name));
});
