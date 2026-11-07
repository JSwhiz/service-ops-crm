import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { TimesheetResponseDto } from '../src/modules/timesheets/dto/timesheet-response.dto';
import type { TimesheetOverviewResponseDto } from '../src/modules/timesheets/dto/timesheet-overview-response.dto';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('timesheet amount enforcement matches scoped read capabilities without changing independent past approval', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  const { app, baseUrl } = await createTestApp();
  t.after(() => app.close());
  const marker = `acl-timesheet-${randomUUID()}`;
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const actors = await Promise.all(['deputy_director', 'director', 'manager'].map(async (code) => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code } });
    const user = await prisma.user.create({ data: { login: `${marker}-${code}`, fullName: `${marker}-${code}`,
      passwordHash: template.passwordHash, isActive: true, roles: { create: { roleId: role.id } } } });
    return { ...user, cookie: await loginAndGetCookieHeader({ baseUrl, login: user.login, password: 'manager123' }) };
  }));
  const [deputy, director, manager] = actors;
  const moscow = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const year = moscow.getUTCFullYear(), month = moscow.getUTCMonth() + 1, day = moscow.getUTCDate();
  const employee = await prisma.employee.create({ data: { fullName: marker, employmentStatus: 'active' } });
  const objects = await Promise.all(['selected', 'control'].map(async (suffix) => {
    const object = await prisma.object.create({ data: {
      name: `${marker}-${suffix}`, address: 'Isolated scoped timesheet', status: 'active', createdByUserId: founder.id,
      paymentType: 'daily', dailyRate: 0,
      assignments: { create: { userId: manager.id, assignmentRoleCode: 'manager', isActive: true } },
    } });
    const container = await prisma.timesheetMonth.create({ data: { objectId: object.id, year, month, createdByUserId: founder.id } });
    await prisma.objectEmployeeAssignment.create({ data: { objectId: object.id, employeeId: employee.id, isActive: true } });
    const row = await prisma.timesheetEmployeeRow.create({ data: { timesheetMonthId: container.id, employeeId: employee.id, employeeNameSnapshot: employee.fullName } });
    for (const dayOfMonth of [...new Set([day, 1])]) await prisma.timesheetDayEntry.create({ data: {
      rowId: row.id, dayOfMonth, autoValue: 0, dayValue: 0, createdByUserId: founder.id,
    } });
    return { ...object, rowId: row.id };
  }));
  const request = (path: string, cookie: string, body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const read = async (index: number, cookie = deputy.cookie) => {
    const response = await request(`/timesheets?${new URLSearchParams({ objectId: objects[index].id, year: String(year), month: String(month) })}`, cookie);
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json() as TimesheetResponseDto;
    const row = result.rows.find((item) => item.employeeId === employee.id);
    assert.ok(row, 'The saved Employee row must remain present');
    assert.equal(row.capabilities.canManualCorrection, result.capabilities.canManualCorrection);
    return result;
  };
  const write = (index: number, cookie = deputy.cookie, dayOfMonth = day, dayValue = 1300) => request('/timesheets/entries', cookie, {
    objectId: objects[index].id, employeeId: employee.id, year, month, dayOfMonth, dayValue, comment: marker,
  });
  const rule = (userId: string, actionCode: string, effect: 'allow' | 'deny', scope: 'selected' | 'all', selectedIds: string[] = []) =>
    prisma.userAccessRule.create({ data: { userId, actionCode, effect, scope, selectedIds } });
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: { in: actors.map((actor) => actor.id) } } });
  const entry = (index: number, dayOfMonth = day) => prisma.timesheetDayEntry.findUniqueOrThrow({ where: {
    rowId_dayOfMonth: { rowId: objects[index].rowId, dayOfMonth },
  } });
  await t.test('legacy director authority is not confused with deputy or assigned manager read access', async () => {
    for (const index of [0, 1]) {
      assert.equal((await read(index)).capabilities.canManualCorrection, false);
      assert.equal((await read(index, director.cookie)).capabilities.canManualCorrection, true);
      assert.equal((await read(index, manager.cookie)).capabilities.canManualCorrection, false);
      const before = await entry(index);
      assert.equal((await write(index)).status, 403);
      assert.deepEqual(await entry(index), before);
    }
  });
  for (const scope of ['selected', 'all'] as const) {
    await t.test(`deputy ${scope} amount grant matches each object capability and actual same-day mutation`, async () => {
      await reset();
      await rule(deputy.id, 'timesheet.amount.edit', 'allow', scope, scope === 'selected' ? [objects[0].id] : []);
      const overviewResponse = await request(`/timesheets/overview?${new URLSearchParams({ year: String(year), month: String(month), employeeId: employee.id })}`, deputy.cookie);
      assert.equal(overviewResponse.status, 200, await overviewResponse.clone().text());
      const overview = await overviewResponse.json() as TimesheetOverviewResponseDto;
      for (const index of [0, 1]) {
        const row = overview.rows.find((item) => item.objectId === objects[index].id && item.employeeId === employee.id);
        assert.ok(row, `Object ${index} requires a real returned row`);
        assert.equal(row.capabilities.canManualCorrection, scope === 'all' || index === 0);
      }
      for (const index of [0, 1]) {
        const allowed = scope === 'all' || index === 0;
        assert.equal((await read(index)).capabilities.canManualCorrection, allowed, `object ${index}`);
        const before = await entry(index);
        const response = await write(index);
        assert.equal(response.status, allowed ? 201 : 403, await response.clone().text());
        if (allowed) {
          const body = await response.json() as TimesheetResponseDto;
          assert.ok(Array.isArray(body.rows), 'Same-day authorized edit must not be misrouted to a pending exception');
          assert.equal((await entry(index)).dayValue, 1300);
        } else assert.deepEqual(await entry(index), before);
      }
      await reset();
      assert.equal((await read(0)).capabilities.canManualCorrection, false, 'Grant revoke is live in the original cookie');
      assert.equal((await write(0)).status, 403);
    });
  }
  await t.test('selected deny subtracts from real director baseline while control object still writes', async () => {
    await reset();
    await rule(director.id, 'timesheet.amount.edit', 'deny', 'selected', [objects[0].id]);
    assert.equal((await read(0, director.cookie)).capabilities.canManualCorrection, false);
    assert.equal((await read(1, director.cookie)).capabilities.canManualCorrection, true);
    const before = await entry(0);
    assert.equal((await write(0, director.cookie)).status, 403);
    assert.deepEqual(await entry(0), before);
    assert.equal((await write(1, director.cookie)).status, 201);
  });
  await t.test('timesheet read parent deny blocks an amount all grant only in denied object', async () => {
    await reset();
    await rule(deputy.id, 'timesheet.amount.edit', 'allow', 'all');
    await rule(deputy.id, 'timesheet.read', 'deny', 'selected', [objects[0].id]);
    const before = await entry(0);
    const denied = await request(`/timesheets?${new URLSearchParams({ objectId: objects[0].id, year: String(year), month: String(month) })}`, deputy.cookie);
    assert.equal(denied.status, 403);
    assert.equal((await write(0)).status, 403);
    assert.deepEqual(await entry(0), before);
    assert.equal((await read(1)).capabilities.canManualCorrection, true);
    assert.equal((await write(1)).status, 201);
  });
  await t.test('past editable-day grant requests independent approval; author/deputy cannot apply it', {
    skip: day === 1 ? 'No earlier editable day exists in this Moscow calendar month; current-month date invariant must remain intact' : false,
  }, async () => {
    await reset();
    await rule(deputy.id, 'timesheet.amount.edit', 'allow', 'all');
    const before = await entry(0, 1);
    const response = await write(0, deputy.cookie, 1, 1700);
    assert.equal(response.status, 201, await response.clone().text());
    const pending = await response.json() as { id: string; status: string; payloadSnapshot: { independentLeadershipRequired: boolean } };
    assert.equal(pending.status, 'pending');
    assert.equal(pending.payloadSnapshot.independentLeadershipRequired, true);
    assert.deepEqual(await entry(0, 1), before);
    await rule(deputy.id, 'approvals.resolve_timesheet', 'allow', 'all');
    assert.equal((await request(`/approvals/${pending.id}/approve`, deputy.cookie, {})).status, 403);
    assert.deepEqual(await entry(0, 1), before);
    assert.equal((await request(`/approvals/${pending.id}/approve`, director.cookie, {})).status, 200);
    assert.equal((await entry(0, 1)).dayValue, 1700);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId: { in: objects.map((object) => object.id) } } }), 0,
      'Manual money and its approval must not fabricate attendance');
  });
  await t.test('selected direct edit elsewhere does not hide an independently permitted control-row exception action', async () => {
    await reset();
    await rule(deputy.id, 'timesheet.amount.edit', 'allow', 'selected', [objects[0].id]);
    await rule(deputy.id, 'timesheet.exceptions.create', 'allow', 'selected', [objects[1].id]);
    const response = await request(`/timesheets/overview?${new URLSearchParams({ year: String(year), month: String(month), employeeId: employee.id })}`, deputy.cookie);
    assert.equal(response.status, 200, await response.clone().text());
    const overview = await response.json() as TimesheetOverviewResponseDto;
    const selected = overview.rows.find((row) => row.objectId === objects[0].id && row.employeeId === employee.id);
    const control = overview.rows.find((row) => row.objectId === objects[1].id && row.employeeId === employee.id);
    assert.ok(selected);
    assert.ok(control);
    assert.equal(overview.capabilities.canManualCorrection, true);
    assert.equal(selected.capabilities.canManualCorrection, true);
    assert.equal(control.capabilities.canManualCorrection, false);
    assert.equal(control.capabilities.canRequestCorrection, true,
      'Do not derive every row exception action from the inverse of the global direct-edit flag');
    const objectSheet = await read(1);
    assert.equal(objectSheet.rows.find((row) => row.employeeId === employee.id)?.capabilities.canRequestCorrection, true);
  });
  await t.test('amount deny is not an implicit exception grant; an independent exception right retains pending workflow', async () => {
    await reset();
    await rule(deputy.id, 'timesheet.amount.edit', 'deny', 'selected', [objects[1].id]);
    const exceptionDeny = await rule(deputy.id, 'timesheet.exceptions.create', 'deny', 'selected', [objects[1].id]);
    const exception = () => request('/timesheets/exceptions', deputy.cookie, {
      objectId: objects[1].id, employeeId: employee.id, year, month, dayOfMonth: day, dayValue: 2100, comment: `${marker}-independent-exception`,
    });
    const before = await entry(1);
    const denied = await read(1);
    assert.equal(denied.capabilities.canManualCorrection, false);
    assert.equal(denied.rows.find((row) => row.employeeId === employee.id)?.capabilities.canRequestCorrection, false);
    assert.equal((await read(0)).rows.find((row) => row.employeeId === employee.id)?.capabilities.canRequestCorrection, true,
      'Selected exception denial must not remove the independent control-object request path');
    assert.equal((await write(1)).status, 403);
    assert.equal((await exception()).status, 403);
    assert.deepEqual(await entry(1), before);
    await prisma.userAccessRule.delete({ where: { id: exceptionDeny.id } });
    await rule(deputy.id, 'timesheet.exceptions.create', 'allow', 'selected', [objects[1].id]);
    const allowed = await read(1);
    assert.equal(allowed.capabilities.canManualCorrection, false);
    assert.equal(allowed.rows.find((row) => row.employeeId === employee.id)?.capabilities.canRequestCorrection, true);
    const response = await exception();
    assert.equal(response.status, 201, await response.clone().text());
    const pending = await response.json() as { id: string; status: string; approvalType: string };
    assert.equal(pending.status, 'pending');
    assert.equal(pending.approvalType, 'manual_timesheet_exception_confirmation');
    assert.deepEqual(await entry(1), before, 'Request capability must not silently become direct mutation');
    assert.equal((await write(1)).status, 403, 'Independent exception workflow does not revoke the amount deny');
  });
  await t.test('selected exception deny on A retains B request capability and rejects A API without new exception or money', async () => {
    await reset();
    await rule(deputy.id, 'timesheet.exceptions.create', 'deny', 'selected', [objects[0].id]);
    assert.equal((await read(0)).rows.find((row) => row.employeeId === employee.id)?.capabilities.canRequestCorrection, false);
    assert.equal((await read(1)).rows.find((row) => row.employeeId === employee.id)?.capabilities.canRequestCorrection, true);
    const before = await entry(0);
    const count = await prisma.timesheetManualException.count({ where: { objectId: objects[0].id } });
    const response = await request('/timesheets/exceptions', deputy.cookie, {
      objectId: objects[0].id, employeeId: employee.id, year, month, dayOfMonth: day, dayValue: 2300, comment: marker,
    });
    assert.equal(response.status, 403, await response.clone().text());
    assert.deepEqual(await entry(0), before);
    assert.equal(await prisma.timesheetManualException.count({ where: { objectId: objects[0].id } }), count);
  });
  await t.test('closed period disables both row actions and rejects direct/exception APIs before any effects', async () => {
    await reset();
    await rule(deputy.id, 'timesheet.amount.edit', 'allow', 'all');
    await rule(deputy.id, 'timesheet.exceptions.create', 'allow', 'all');
    const container = await prisma.timesheetMonth.findUniqueOrThrow({ where: {
      objectId_year_month: { objectId: objects[1].id, year, month },
    } });
    await prisma.timesheetMonth.update({ where: { id: container.id }, data: { status: 'closed' } });
    try {
      const before = await prisma.timesheetDayEntry.findMany({ where: { rowId: objects[1].rowId }, orderBy: { dayOfMonth: 'asc' } });
      const exceptionsBefore = await prisma.timesheetManualException.count({ where: { objectId: objects[1].id } });
      const approvalsBefore = await prisma.approvalRequest.count({ where: { createdByUserId: deputy.id } });
      const result = await read(1);
      const row = result.rows.find((item) => item.employeeId === employee.id);
      assert.ok(row);
      assert.deepEqual(row.capabilities, { canManualCorrection: false, canRequestCorrection: false });
      assert.equal((await write(1)).status, 403);
      const requestException = await request('/timesheets/exceptions', deputy.cookie, {
        objectId: objects[1].id, employeeId: employee.id, year, month, dayOfMonth: day, dayValue: 2400, comment: marker,
      });
      assert.equal(requestException.status, 409, await requestException.clone().text());
      assert.deepEqual(await prisma.timesheetDayEntry.findMany({ where: { rowId: objects[1].rowId }, orderBy: { dayOfMonth: 'asc' } }), before);
      assert.equal(await prisma.timesheetManualException.count({ where: { objectId: objects[1].id } }), exceptionsBefore);
      assert.equal(await prisma.approvalRequest.count({ where: { createdByUserId: deputy.id } }), approvalsBefore);
    } finally {
      await prisma.timesheetMonth.update({ where: { id: container.id }, data: { status: container.status } });
    }
  });
});
