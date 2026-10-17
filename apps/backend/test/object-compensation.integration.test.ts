import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { createCoreTestObject, cleanupCoreTestObject, SEEDED_EMPLOYEE_IDS } from './helpers/core-fixtures';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('deputy director manages object rates while manager only records an extra shift', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const { objectId } = await createCoreTestObject(prisma, { includeManagerAssignment: true });
  let substitutionId: string | null = null;

  t.after(async () => {
    if (substitutionId) await prisma.userSubstitution.deleteMany({ where: { id: substitutionId } });
    await cleanupCoreTestObject(prisma, objectId);
    await prisma.objectCompensationRate.deleteMany({ where: { objectId } });
    await prisma.auditEvent.deleteMany({ where: { entityType: { in: ['object', 'object_compensation_rate', 'object_attendance'] }, entityId: objectId } });
    await prisma.notification.deleteMany({ where: { entityType: 'object', entityId: objectId } });
    await app.close();
    await prisma.$disconnect();
  });

  const [deputyCookie, managerCookie, founderCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'deputy1', password: 'deputy123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' }),
  ]);
  const route = `${baseUrl}/api/v1/objects/${objectId}`;

  const deputyProfileEdit = await fetch(route, {
    method: 'PATCH',
    headers: { Cookie: deputyCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summerDailyRate: 3300, summerScheduleWeekdays: ['mon', 'wed'] }),
  });
  assert.equal(deputyProfileEdit.status, 200, await deputyProfileEdit.clone().text());
  const deputyCannotEditCoreFields = await fetch(route, {
    method: 'PATCH',
    headers: { Cookie: deputyCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summerDailyRate: 3400, name: 'Unauthorized rename' }),
  });
  assert.equal(deputyCannotEditCoreFields.status, 403);
  assert.equal((await prisma.object.findUniqueOrThrow({ where: { id: objectId }, select: { name: true, dailyRate: true } })).name.startsWith('Integration Core Object'), true);

  const ratesBeforeManagerSeasonChange = await prisma.object.findUniqueOrThrow({
    where: { id: objectId },
    select: { dailyRate: true, paymentScheduleCode: true, paymentScheduleWeekdays: true },
  });
  const managerCannotChangeSeason = await fetch(route, {
    method: 'PATCH',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ seasonMode: 'winter' }),
  });
  assert.equal(managerCannotChangeSeason.status, 403);
  assert.deepEqual(
    await prisma.object.findUniqueOrThrow({
      where: { id: objectId },
      select: { dailyRate: true, paymentScheduleCode: true, paymentScheduleWeekdays: true },
    }),
    ratesBeforeManagerSeasonChange,
  );

  const rateResponse = await fetch(`${route}/compensation-rates`, {
    method: 'POST',
    headers: { Cookie: deputyCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Интеграционная подмена',
      category: 'substitution',
      ratePolicyType: 'monthly_fixed',
      baseAmount: 72000,
      scheduleCode: '5/2',
      scheduleWeekdays: ['mon', 'wed'],
    }),
  });
  assert.equal(rateResponse.status, 201);
  const rate = (await rateResponse.json()) as { id: string };

  const dailyRateResponse = await fetch(`${route}/compensation-rates`, {
    method: 'POST',
    headers: { Cookie: deputyCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Интеграционная ставка за выход',
      category: 'standard',
      ratePolicyType: 'daily_rate',
      baseAmount: 1800,
      scheduleCode: '5/2',
      scheduleWeekdays: ['mon', 'wed'],
    }),
  });
  assert.equal(dailyRateResponse.status, 201, await dailyRateResponse.clone().text());
  const dailyRateOption = await dailyRateResponse.json() as {
    id: string;
    ratePolicyType: string;
    baseAmount: number;
    scheduleCode: string;
    scheduleWeekdays: string[];
  };
  assert.deepEqual(
    {
      ratePolicyType: dailyRateOption.ratePolicyType,
      baseAmount: dailyRateOption.baseAmount,
      scheduleCode: dailyRateOption.scheduleCode,
      scheduleWeekdays: dailyRateOption.scheduleWeekdays,
    },
    {
      ratePolicyType: 'daily_rate',
      baseAmount: 1800,
      scheduleCode: '5/2',
      scheduleWeekdays: ['mon', 'wed'],
    },
  );

  const managerCanViewRates = await fetch(`${route}/compensation-rates`, {
    headers: { Cookie: managerCookie },
  });
  assert.equal(managerCanViewRates.status, 200);

  const managerCannotCreateRate = await fetch(`${route}/compensation-rates`, {
    method: 'POST',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Недопустимо', category: 'standard', ratePolicyType: 'daily_rate', baseAmount: 1000 }),
  });
  assert.equal(managerCannotCreateRate.status, 403);

  const assignedRate = await fetch(`${route}/employees/${SEEDED_EMPLOYEE_IDS.ivan}/rate-policy`, {
    method: 'PUT',
    headers: { Cookie: deputyCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ratePolicyType: 'monthly_fixed',
      baseAmount: 72000,
      rateOptionId: rate.id,
      scheduleCode: '5/2',
      scheduleWeekdays: ['mon', 'wed'],
    }),
  });
  assert.equal(assignedRate.status, 200);

  const assignedDailyRate = await fetch(`${route}/employees/${SEEDED_EMPLOYEE_IDS.ivan}/rate-policy`, {
    method: 'PUT',
    headers: { Cookie: deputyCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ratePolicyType: 'daily_rate',
      baseAmount: 1800,
      rateOptionId: dailyRateOption.id,
      scheduleCode: '5/2',
      scheduleWeekdays: ['mon', 'wed'],
    }),
  });
  assert.equal(assignedDailyRate.status, 200, await assignedDailyRate.clone().text());
  const storedAssignedDailyRate = await prisma.objectEmployeeAssignment.findUniqueOrThrow({
    where: { objectId_employeeId: { objectId, employeeId: SEEDED_EMPLOYEE_IDS.ivan } },
    select: { ratePolicyType: true, ratePolicyBaseAmount: true, ratePolicyScheduleCode: true, ratePolicyWeekdays: true, rateOptionId: true },
  });
  assert.deepEqual(storedAssignedDailyRate, {
    ratePolicyType: 'daily_rate',
    ratePolicyBaseAmount: 1800,
    ratePolicyScheduleCode: '5/2',
    ratePolicyWeekdays: ['mon', 'wed'],
    rateOptionId: dailyRateOption.id,
  });

  const managerCannotReassignRate = await fetch(`${route}/employees/${SEEDED_EMPLOYEE_IDS.ivan}/rate-policy`, {
    method: 'PUT',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ratePolicyType: 'daily_rate', baseAmount: 1 }),
  });
  assert.equal(managerCannotReassignRate.status, 403);

  const defaultsResponse = await fetch(`${route}/compensation`, {
    method: 'PUT',
    headers: { Cookie: deputyCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      winterPaymentType: 'daily',
      winterDailyRate: 2200,
      winterMonthlySalary: 50000,
      winterScheduleCode: '5/2',
      winterScheduleWeekdays: ['tue'],
    }),
  });
  assert.equal(defaultsResponse.status, 200);
  const storedWinterProfile = await prisma.object.findUniqueOrThrow({
    where: { id: objectId },
    select: { winterPaymentType: true, winterDailyRate: true, winterMonthlySalary: true, winterScheduleWeekdays: true, dailyRate: true },
  });
  assert.deepEqual(storedWinterProfile, {
    winterPaymentType: 'daily',
    winterDailyRate: 2200,
    winterMonthlySalary: 50000,
    winterScheduleWeekdays: ['tue'],
    dailyRate: ratesBeforeManagerSeasonChange.dailyRate,
  });

  const activateWinterProfile = await fetch(route, {
    method: 'PATCH',
    headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ seasonMode: 'winter' }),
  });
  assert.equal(activateWinterProfile.status, 200, await activateWinterProfile.clone().text());
  const activeWinterRates = await prisma.object.findUniqueOrThrow({
    where: { id: objectId },
    select: { paymentType: true, dailyRate: true, monthlySalary: true, paymentScheduleWeekdays: true },
  });
  assert.deepEqual(activeWinterRates, {
    paymentType: 'daily',
    dailyRate: 2200,
    monthlySalary: 50000,
    paymentScheduleWeekdays: ['tue'],
  });

  const storedSummerProfile = await prisma.object.findUniqueOrThrow({
    where: { id: objectId },
    select: {
      summerPaymentType: true,
      summerDailyRate: true,
      summerMonthlySalary: true,
      summerScheduleCode: true,
      summerScheduleWeekdays: true,
    },
  });

  const activateSummerProfile = await fetch(route, {
    method: 'PATCH',
    headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ seasonMode: 'summer' }),
  });
  assert.equal(activateSummerProfile.status, 200, await activateSummerProfile.clone().text());
  assert.deepEqual(
    await prisma.object.findUniqueOrThrow({
      where: { id: objectId },
      select: { paymentType: true, dailyRate: true, monthlySalary: true, paymentScheduleCode: true, paymentScheduleWeekdays: true },
    }),
    {
      paymentType: storedSummerProfile.summerPaymentType,
      dailyRate: storedSummerProfile.summerDailyRate,
      monthlySalary: storedSummerProfile.summerMonthlySalary,
      paymentScheduleCode: storedSummerProfile.summerScheduleCode,
      paymentScheduleWeekdays: storedSummerProfile.summerScheduleWeekdays,
    },
  );

  const activeSeasonDefaultsResponse = await fetch(`${route}/compensation`, {
    method: 'PUT',
    headers: { Cookie: deputyCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summerPaymentType: 'monthly',
      summerDailyRate: 4000,
      summerMonthlySalary: 80000,
      summerScheduleCode: '5/2',
      summerScheduleWeekdays: ['mon', 'wed'],
    }),
  });
  assert.equal(activeSeasonDefaultsResponse.status, 200);
  const activeSummerRates = await prisma.object.findUniqueOrThrow({
    where: { id: objectId },
    select: { paymentType: true, dailyRate: true, monthlySalary: true, paymentScheduleWeekdays: true },
  });
  assert.deepEqual(activeSummerRates, {
    paymentType: 'monthly',
    dailyRate: 4000,
    monthlySalary: 80000,
    paymentScheduleWeekdays: ['mon', 'wed'],
  });

  const attendanceDate = new Date().toISOString().slice(0, 10);
  const attendanceResponse = await fetch(`${route}/attendance`, {
    method: 'POST',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operationDate: attendanceDate,
      employeeIds: [SEEDED_EMPLOYEE_IDS.ivan],
      employeeFacts: [{ employeeId: SEEDED_EMPLOYEE_IDS.ivan, ratePolicyType: 'side_job', rateAmount: 3500, rateReason: 'Дополнительная уборка по заявке' }],
    }),
  });
  assert.equal(attendanceResponse.status, 201);
  const attendance = await prisma.objectAttendanceFact.findFirstOrThrow({
    where: { objectId, employeeId: SEEDED_EMPLOYEE_IDS.ivan },
    orderBy: { createdAt: 'desc' },
    select: { dailyRateSnapshot: true, ratePolicySnapshot: true },
  });
  assert.equal(attendance.dailyRateSnapshot, 3500);
  assert.equal((attendance.ratePolicySnapshot as { ratePolicyType: string }).ratePolicyType, 'side_job');
  assert.ok(await prisma.notification.findFirst({ where: { entityId: objectId, type: 'object.extra_shift.created' } }));

  const [founder, manager] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' }, select: { id: true } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' }, select: { id: true } }),
  ]);
  const delegation = await prisma.userSubstitution.create({
    data: {
      principalUserId: founder.id,
      replacementUserId: manager.id,
      createdByUserId: founder.id,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 3_600_000),
      reason: 'Integration test: scoped non-rate edit',
      objects: { create: { objectId } },
    },
  });
  substitutionId = delegation.id;
  const beforeSeasonOnlyEdit = await prisma.object.findUniqueOrThrow({
    where: { id: objectId },
    select: { dailyRate: true, monthlySalary: true, paymentType: true, paymentScheduleCode: true, paymentScheduleWeekdays: true },
  });
  const delegatedSeasonChange = await fetch(route, {
    method: 'PATCH',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ seasonMode: 'winter' }),
  });
  assert.equal(delegatedSeasonChange.status, 200, await delegatedSeasonChange.clone().text());
  const afterSeasonOnlyEdit = await prisma.object.findUniqueOrThrow({
    where: { id: objectId },
    select: { dailyRate: true, monthlySalary: true, paymentType: true, paymentScheduleCode: true, paymentScheduleWeekdays: true },
  });
  assert.deepEqual(afterSeasonOnlyEdit, beforeSeasonOnlyEdit);
});

test('HR-only object visibility redacts object and employee compensation while assigned manager can view it', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const { objectId } = await createCoreTestObject(prisma, { includeManagerAssignment: true });
  const hr = await prisma.user.findUniqueOrThrow({ where: { login: 'hr1' }, select: { id: true } });
  const permissionCodes = ['objects.view_hr', 'employees.assignments.manage'];
  const permissions = await Promise.all(permissionCodes.map((code) => prisma.permission.upsert({
    where: { code },
    update: {},
    create: { code, name: `${code} (integration)` },
  })));
  for (const permission of permissions) {
    await prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: hr.id, permissionId: permission.id } },
      update: {},
      create: { userId: hr.id, permissionId: permission.id },
    });
  }

  t.after(async () => {
    await prisma.userPermission.deleteMany({ where: { userId: hr.id, permissionId: { in: permissions.map(({ id }) => id) } } });
    await cleanupCoreTestObject(prisma, objectId);
    await prisma.objectCompensationRate.deleteMany({ where: { objectId } });
    await prisma.auditEvent.deleteMany({ where: { entityType: 'object', entityId: objectId } });
    await app.close();
    await prisma.$disconnect();
  });

  const [hrCookie, managerCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'hr1', password: 'hr123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
  ]);
  const route = `${baseUrl}/api/v1/objects/${objectId}`;
  const hrDetailResponse = await fetch(route, { headers: { Cookie: hrCookie } });
  assert.equal(hrDetailResponse.status, 200);
  const hrDetail = await hrDetailResponse.json() as {
    paymentType: string | null; dailyRate: number | null; monthlySalary: number | null;
    paymentScheduleCode: string | null; paymentScheduleWeekdays: string[];
    summerDailyRate: number | null; summerMonthlySalary: number | null;
    winterDailyRate: number | null; winterMonthlySalary: number | null;
    capabilities: { canViewCompensationRates: boolean };
    employees: Array<{ baseDailyRate: number | null }>;
  };
  const redactedRateFields: Record<string, unknown> = hrDetail;
  for (const field of ['paymentType', 'dailyRate', 'monthlySalary', 'paymentScheduleCode', 'summerDailyRate', 'summerMonthlySalary', 'winterDailyRate', 'winterMonthlySalary']) {
    assert.equal(redactedRateFields[field], null, `HR detail ${field} should be redacted`);
  }
  assert.deepEqual(hrDetail.paymentScheduleWeekdays, []);
  assert.equal(hrDetail.capabilities.canViewCompensationRates, false);
  assert.equal(hrDetail.employees[0].baseDailyRate, null);

  const hrListResponse = await fetch(`${baseUrl}/api/v1/objects?q=${encodeURIComponent('Integration Core Object')}`, { headers: { Cookie: hrCookie } });
  assert.equal(hrListResponse.status, 200);
  const hrList = await hrListResponse.json() as { items: Array<{ id: string; dailyRate: number | null; summerDailyRate: number | null }> };
  const hrListObject = hrList.items.find((item) => item.id === objectId);
  assert.ok(hrListObject);
  assert.equal(hrListObject.dailyRate, null);
  assert.equal(hrListObject.summerDailyRate, null);

  const hrEmployeesResponse = await fetch(`${route}/employees`, { headers: { Cookie: hrCookie } });
  assert.equal(hrEmployeesResponse.status, 200);
  const hrEmployees = await hrEmployeesResponse.json() as Array<{ baseDailyRate: number | null; ratePolicy: unknown }>;
  assert.ok(hrEmployees.length > 0);
  assert.ok(hrEmployees.every((employee) => employee.baseDailyRate === null && employee.ratePolicy === null));

  const hrDirectoryResponse = await fetch(`${route}/employee-directory?search=Иван`, { headers: { Cookie: hrCookie } });
  assert.equal(hrDirectoryResponse.status, 200);
  const hrDirectory = await hrDirectoryResponse.json() as Array<{ baseDailyRate: number | null; ratePolicy: unknown }>;
  assert.ok(hrDirectory.every((employee) => employee.baseDailyRate === null && employee.ratePolicy === null));

  const managerDetailResponse = await fetch(route, { headers: { Cookie: managerCookie } });
  assert.equal(managerDetailResponse.status, 200);
  const managerDetail = await managerDetailResponse.json() as { dailyRate: number; capabilities: { canViewCompensationRates: boolean } };
  assert.equal(managerDetail.dailyRate, 2500);
  assert.equal(managerDetail.capabilities.canViewCompensationRates, true);

  const managerEmployeesResponse = await fetch(`${route}/employees`, { headers: { Cookie: managerCookie } });
  assert.equal(managerEmployeesResponse.status, 200);
  const managerEmployees = await managerEmployeesResponse.json() as Array<{ ratePolicy: { baseAmount: number } | null }>;
  assert.ok(managerEmployees.some((employee) => (employee.ratePolicy?.baseAmount ?? 0) > 0));
});

test('object create and update activate the selected seasonal schedule with legacy fallback', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' }, select: { id: true } });
  const createdObjectIds: string[] = [];

  t.after(async () => {
    for (const objectId of createdObjectIds) {
      await cleanupCoreTestObject(prisma, objectId);
      await prisma.auditEvent.deleteMany({ where: { entityType: 'object', entityId: objectId } });
      await prisma.notification.deleteMany({ where: { entityType: 'object', entityId: objectId } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  const createResponse = await fetch(`${baseUrl}/api/v1/objects`, {
    method: 'POST',
    headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Season schedule integration test',
      internalName: 'SEASON-IT',
      address: 'Test address 1',
      status: 'active',
      responsibleUserId: founder.id,
      seasonMode: 'summer',
      paymentScheduleCode: '5/2',
      paymentScheduleWeekdays: ['fri'],
      summerScheduleCode: '6/1',
      summerScheduleWeekdays: ['mon', 'wed'],
      winterScheduleCode: '4/3',
      winterScheduleWeekdays: ['tue'],
    }),
  });
  assert.equal(createResponse.status, 201);
  const createdObject = (await createResponse.json()) as { id: string };
  createdObjectIds.push(createdObject.id);

  const readActiveSchedule = async (): Promise<{ paymentScheduleCode: string | null; paymentScheduleWeekdays: string[] }> => {
    const object = await prisma.object.findUniqueOrThrow({
      where: { id: createdObject.id },
      select: { paymentScheduleCode: true, paymentScheduleWeekdays: true },
    });
    return object;
  };

  assert.deepEqual(await readActiveSchedule(), {
    paymentScheduleCode: '6/1',
    paymentScheduleWeekdays: ['mon', 'wed'],
  });

  await prisma.object.update({
    where: { id: createdObject.id },
    data: { paymentScheduleCode: '5/2', paymentScheduleWeekdays: ['fri'] },
  });
  const metadataUpdateResponse = await fetch(`${baseUrl}/api/v1/objects/${createdObject.id}`, {
    method: 'PATCH',
    headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: 'Metadata-only update' }),
  });
  assert.equal(metadataUpdateResponse.status, 200);
  assert.deepEqual(await readActiveSchedule(), {
    paymentScheduleCode: '5/2',
    paymentScheduleWeekdays: ['fri'],
  });

  const updateSeason = async (
    seasonMode: 'summer' | 'winter' | null,
    schedule?: { paymentScheduleCode: string; paymentScheduleWeekdays: string[] },
  ): Promise<void> => {
    const response = await fetch(`${baseUrl}/api/v1/objects/${createdObject.id}`, {
      method: 'PATCH',
      headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ seasonMode, ...schedule }),
    });
    assert.equal(response.status, 200);
  };

  await updateSeason('winter');
  assert.deepEqual(await readActiveSchedule(), {
    paymentScheduleCode: '4/3',
    paymentScheduleWeekdays: ['tue'],
  });

  await updateSeason(null, { paymentScheduleCode: '5/2', paymentScheduleWeekdays: ['fri'] });
  assert.deepEqual(await readActiveSchedule(), {
    paymentScheduleCode: '5/2',
    paymentScheduleWeekdays: ['fri'],
  });

  await prisma.object.update({
    where: { id: createdObject.id },
    data: { summerScheduleCode: null, summerScheduleWeekdays: [] },
  });
  await updateSeason('summer', { paymentScheduleCode: '5/2', paymentScheduleWeekdays: ['fri'] });
  assert.deepEqual(await readActiveSchedule(), {
    paymentScheduleCode: '5/2',
    paymentScheduleWeekdays: ['fri'],
  });
});
