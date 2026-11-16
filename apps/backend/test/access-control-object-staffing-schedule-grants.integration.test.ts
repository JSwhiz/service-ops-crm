import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { todayMoscow } from '../src/modules/object-scheduling/scheduling-calendar';
import type { CreatePositionDto } from '../src/modules/object-scheduling/scheduling.dto';
import type { PositionView, PreviewResponse } from '../src/modules/object-scheduling/scheduling.types';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Scope = 'own' | 'assigned' | 'selected' | 'all';
type Contour = { id: string; version: number; dailyRate: number };
type Attendance = { id: string; version: number; status: string; employeeId: string; dailyRateSnapshot: number };
const covered = ['staffing.manage', 'attendance.read', 'attendance.edit', 'schedules.read', 'schedules.manage', 'pay_conditions.select'] as const;

// Bounded scheduling paths, not legacy daily staffing/attendance, substitutions,
// historical approvals, payroll formulas, or every role/scope combination.
test('six object staffing/schedule leaves enforce real HTTP scopes, independent assignments and planned/actual/pay boundaries', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const database = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(database.hostname));
  assert.equal(database.port, '55432');
  assert.match(database.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  for (const suffix of covered) {
    const action = ACCESS_ACTION_CATALOG.find((entry) => entry.code === `objects.${suffix}`)!;
    assert.equal(action.manageable, true);
    assert.deepEqual(action.allowedScopes, ['own', 'assigned', 'selected', 'all']);
  }
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  const ruleIds = new Set<string>();
  const reset = async () => {
    await prisma.userAccessRule.deleteMany({ where: { id: { in: [...ruleIds] } } });
    ruleIds.clear();
  };
  t.after(async () => {
    try { await reset(); } finally { try { await closeApp?.(); } finally { await prisma.$disconnect(); } }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const actor = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' }, include: {
    roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    permissions: { include: { permission: true } },
  } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  assert.deepEqual(actor.roles.map(({ role }) => role.code), ['manager']);
  const originalPermissions = [...actor.permissions.map(({ permission }) => permission.code),
    ...actor.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code))];
  assert.equal(originalPermissions.includes('employees.assignments.manage'), false);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id } }), 0);
  const actorCookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  const marker = `acl-object-staffing-schedule-${randomUUID()}`;
  const today = todayMoscow();
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const objectIds: string[] = [];
  const employeeIds: string[] = [];
  let sequence = 0;
  const root = (id: string) => `/objects/${id}/scheduling`;
  const request = (path: string, method = 'GET', body?: unknown, leadership = false) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: leadership ? founderCookie : actorCookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, expected = 200): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, expected, text);
    return JSON.parse(text) as T;
  };
  const rule = async (actionCode: string, effect: 'allow' | 'deny', scope: Scope = 'all', selectedIds: string[] = []) => {
    assert.ok(ACCESS_ACTION_CATALOG.find((entry) => entry.code === actionCode)?.allowedScopes.includes(scope));
    const saved = await prisma.userAccessRule.upsert({ where: { userId_actionCode: { userId: actor.id, actionCode } },
      create: { userId: actor.id, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds } });
    ruleIds.add(saved.id);
  };
  const revoke = async (actionCode: string) => {
    const saved = await prisma.userAccessRule.delete({ where: { userId_actionCode: { userId: actor.id, actionCode } } });
    ruleIds.delete(saved.id);
  };
  const employee = async () => {
    const saved = await prisma.employee.create({ data: { fullName: `${marker}-employee-${++sequence}`, employmentStatus: 'active', baseDailyRate: 100 } });
    employeeIds.push(saved.id);
    return saved;
  };
  const plan = (employeeId: string, contourId: string | null = null): CreatePositionDto => ({
    clientKey: randomUUID(), name: `${marker}-position-${++sequence}`, headcount: 1, requiredPerShift: 1, effectiveFrom: today,
    template: { kind: 'weekly', weekdays: [1, 2, 3, 4, 5, 6, 7] },
    groups: [{ key: 'A', name: 'Day', offsetDays: 0, assignments: [{ employeeId, from: today }],
      timeRanges: [{ key: 'day', start: '08:00', end: '16:00', endDayOffset: 0, contourId }] }],
  });
  const fields = (input: CreatePositionDto) => {
    const { clientKey, ...body } = input;
    assert.ok(clientKey);
    return body;
  };
  const fixture = async (label: string, scope: 'foreign' | 'own' | 'assigned' = 'foreign') => {
    const person = await employee();
    const object = await prisma.object.create({ data: {
      name: `${marker}-${label}-${++sequence}`, address: 'Isolated staffing/schedule fixture', status: 'active',
      createdByUserId: scope === 'own' ? actor.id : founder.id, paymentType: 'daily', dailyRate: 100,
      ...(scope === 'assigned' ? { assignments: { create: { userId: actor.id, assignmentRoleCode: 'manager', isActive: true } } } : {}),
    } });
    objectIds.push(object.id);
    await prisma.objectEmployeeAssignment.create({ data: { objectId: object.id, employeeId: person.id, isActive: true } });
    const contour = await json<Contour>(await request(`${root(object.id)}/contours`, 'POST', { code: 'ready', name: 'Existing ready condition', dailyRate: 100 }, true), 201);
    const input = plan(person.id, contour.id);
    const position = await json<PositionView>(await request(`${root(object.id)}/positions`, 'POST', input, true), 201);
    return { object, person, contour, input, position };
  };
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  const confirmation = (f: Fixture) => ({ requestKey: randomUUID(), positionId: f.position.id, revisionId: f.position.revisions.at(-1)!.id,
    groupKey: 'A', timeRangeKey: 'day', employeeId: f.person.id, operationDate: today });
  const capture = async () => {
    const [objects, users, roles, permissions, employees, assignments, history, positions, contours, terms, shifts, facts, months, rows, days, credits, adjustments, approvals, audits, objectAudits] = await Promise.all([
      prisma.object.findMany({ where: { id: { in: objectIds } }, orderBy: { id: 'asc' }, include: { assignments: { orderBy: { id: 'asc' } } } }),
      prisma.user.findMany({ orderBy: { id: 'asc' }, select: { id: true, login: true, isActive: true } }),
      prisma.userRole.findMany({ where: { userId: actor.id }, orderBy: { id: 'asc' } }),
      prisma.userPermission.findMany({ where: { userId: actor.id }, orderBy: { id: 'asc' } }),
      prisma.employee.findMany({ where: { id: { in: employeeIds } }, orderBy: { id: 'asc' } }),
      prisma.objectEmployeeAssignment.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
      prisma.employeeObjectAssignmentHistory.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
      prisma.objectStaffPosition.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' }, include: { revisions: { orderBy: { version: 'asc' } } } }),
      prisma.objectPayContour.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
      prisma.objectCompensationVersion.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
      prisma.objectShiftAttendance.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
      prisma.objectAttendanceFact.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
      prisma.timesheetMonth.findMany({ orderBy: { id: 'asc' } }),
      prisma.timesheetEmployeeRow.findMany({ orderBy: { id: 'asc' } }),
      prisma.timesheetDayEntry.findMany({ orderBy: { id: 'asc' } }),
      prisma.objectPayrollCredit.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
      prisma.objectCompensationAdjustment.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
      prisma.approvalRequest.findMany({ orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
      prisma.objectAuditLog.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    ]);
    return { objects, users, roles, permissions, employees, assignments, history, positions, contours, terms, shifts, facts, months, rows, days, credits, adjustments, approvals, audits, objectAudits };
  };
  type State = Awaited<ReturnType<typeof capture>>;
  const noActualChange = (before: State, after: State) => {
    for (const key of ['users', 'roles', 'permissions', 'employees', 'contours', 'terms', 'shifts', 'facts', 'months', 'rows', 'days', 'credits', 'adjustments', 'approvals'] as const) assert.deepEqual(after[key], before[key], `${key}: planning/selection must not create attendance, identities or money`);
  };
  const denied = async (path: string, method = 'GET', body?: unknown, status = 403) => {
    const before = await capture();
    const response = await request(path, method, body);
    const text = await response.text();
    assert.deepEqual(await capture(), before, `${method} ${path}: denied/invalid operation must have zero persisted effects`);
    assert.equal(response.status, status, text);
  };
  const audit = async (objectId: string, actionCode: string) => assert.ok(await prisma.objectAuditLog.findFirst({ where: { objectId, actorUserId: actor.id, actionCode } }), `Missing actual ${actionCode} actor audit`);
  const parentDenials = async (objectId: string, send: () => Promise<void>) => {
    for (const action of ['objects.read', 'objects.access']) {
      await rule(action, 'deny', 'selected', [objectId]);
      try { await send(); } finally { await revoke(action); }
    }
  };
  const foreignA = await fixture('foreign-A');
  const foreignB = await fixture('foreign-B');
  const own = await fixture('own', 'own');
  const assigned = await fixture('assigned', 'assigned');
  const savedAttendance = await json<Attendance>(await request(`${root(foreignA.object.id)}/attendance/confirm`, 'POST', confirmation(foreignA), true), 201);

  for (const leaf of ['schedules.read', 'attendance.read'] as const) {
    await t.test(`${leaf}: real selected/all grant, control B, deny/revoke and read/root parents are side-effect free`, async (suite) => {
      suite.after(reset);
      const path = (f: Fixture) => leaf === 'schedules.read' ? `${root(f.object.id)}/positions` : `${root(f.object.id)}/attendance?from=${today}&to=${today}`;
      const read = async (f: Fixture) => {
        const body = await json<{ positions?: PositionView[]; attendance?: Attendance[] }>(await request(path(f)));
        if (leaf === 'schedules.read') assert.ok(body.positions?.some((entry) => entry.id === f.position.id));
        else if (f === foreignA) assert.ok(body.attendance?.some((entry) => entry.id === savedAttendance.id && entry.employeeId === f.person.id));
      };
      await denied(path(foreignA));
      await rule(`objects.${leaf}`, 'allow', 'selected', [foreignA.object.id]);
      const before = await capture();
      await read(foreignA);
      await denied(path(foreignB));
      await parentDenials(foreignA.object.id, () => denied(path(foreignA)));
      await rule(`objects.${leaf}`, 'deny', 'selected', [foreignA.object.id]);
      await denied(path(foreignA));
      await revoke(`objects.${leaf}`);
      await denied(path(foreignA));
      await rule(`objects.${leaf}`, 'allow', 'all');
      await read(foreignA);
      await read(foreignB);
      await rule(`objects.${leaf}`, 'deny', 'all');
      await denied(path(foreignB));
      assert.deepEqual(await capture(), before);
    });
  }

  for (const scope of ['own', 'assigned'] as const) {
    await t.test(`${scope} read rules match actual object ownership/active User assignment, not Employee staffing`, async (suite) => {
      suite.after(reset);
      const target = scope === 'own' ? own : assigned;
      const control = scope === 'own' ? assigned : own;
      for (const leaf of ['schedules.read', 'attendance.read']) {
        const path = (f: Fixture) => `${root(f.object.id)}/${leaf === 'schedules.read' ? 'positions' : `attendance?from=${today}&to=${today}`}`;
        const before = await capture();
        await json(await request(path(target)));
        await rule(`objects.${leaf}`, 'deny', scope);
        await denied(path(target));
        await json(await request(path(control)));
        await rule(`objects.${leaf}`, 'allow', scope);
        await json(await request(path(target)));
        await denied(path(foreignB));
        await revoke(`objects.${leaf}`);
        await json(await request(path(target)));
        assert.deepEqual(await capture(), before);
      }
    });
  }

  await t.test('schedules.manage selected/all creates, versions and archives plans without staffing/attendance/pay side effects', async (suite) => {
    suite.after(reset);
    const input = plan(foreignA.person.id); // Existing Employee staffing, no new pay binding.
    const path = `${root(foreignA.object.id)}/positions`;
    await denied(path, 'POST', input);
    await rule('objects.schedules.manage', 'allow', 'selected', [foreignA.object.id]);
    await parentDenials(foreignA.object.id, () => denied(path, 'POST', input));
    const before = await capture();
    const created = await json<PositionView>(await request(path, 'POST', input), 201);
    const after = await capture();
    assert.equal(created.version, 1);
    assert.equal(created.revisions[0].createdByUserId, actor.id);
    assert.equal(after.positions.length, before.positions.length + 1);
    assert.deepEqual(after.positions.filter((entry) => entry.id !== created.id), before.positions);
    assert.deepEqual(after.assignments, before.assignments);
    assert.deepEqual(after.history, before.history);
    noActualChange(before, after);
    await audit(foreignA.object.id, 'scheduling_position_created');
    await denied(`${root(foreignB.object.id)}/positions`, 'POST', plan(foreignB.person.id));
    const body = { ...fields(input), expectedVersion: 1, name: 'Updated schedule, not attendance' };
    const updated = await json<PositionView>(await request(`${path}/${created.id}`, 'PUT', body));
    assert.equal(updated.version, 2);
    assert.equal(updated.revisions.length, 2);
    assert.deepEqual(updated.revisions[0], created.revisions[0]);
    await audit(foreignA.object.id, 'scheduling_position_versioned');
    await denied(`${path}/${created.id}`, 'PUT', body, 409);
    await rule('objects.schedules.manage', 'deny', 'selected', [foreignA.object.id]);
    await denied(`${path}/${created.id}`, 'PUT', { ...body, expectedVersion: 2 });
    await revoke('objects.schedules.manage');
    await denied(`${path}/${created.id}`, 'PUT', { ...body, expectedVersion: 2 });
    await rule('objects.schedules.manage', 'allow', 'all');
    const archived = await json<PositionView>(await request(`${path}/${created.id}`, 'DELETE', { expectedVersion: 2, effectiveFrom: today, reason: 'Archive only the plan' }));
    assert.equal(archived.version, 3);
    assert.equal(archived.revisions.at(-1)!.archived, true);
    await audit(foreignA.object.id, 'scheduling_position_archived');
    noActualChange(before, await capture());
    await prisma.object.update({ where: { id: foreignB.object.id }, data: { status: 'frozen' } });
    try { await denied(`${root(foreignB.object.id)}/positions`, 'POST', plan(foreignB.person.id), 409); }
    finally { await prisma.object.update({ where: { id: foreignB.object.id }, data: { status: 'active' } }); }
  });

  await t.test('staffing.manage requires the independent Employee assignment leaf; grants create only explicit staffing/history', async (suite) => {
    suite.after(reset);
    const person = await employee();
    const path = `${root(foreignA.object.id)}/positions`;
    const input = plan(person.id);
    await rule('objects.schedules.manage', 'allow', 'all');
    await denied(path, 'POST', input);
    await rule('objects.staffing.manage', 'allow', 'selected', [foreignA.object.id]);
    await denied(path, 'POST', input);
    await rule('employees.assignments.manage', 'allow', 'selected', [person.id]);
    await parentDenials(foreignA.object.id, () => denied(path, 'POST', input));
    await rule('employees.assignments.manage', 'deny', 'selected', [person.id]);
    await denied(path, 'POST', input);
    await rule('employees.assignments.manage', 'allow', 'selected', [person.id]);
    await denied(`${root(foreignB.object.id)}/positions`, 'POST', input);
    const before = await capture();
    const created = await json<PositionView>(await request(path, 'POST', input), 201);
    const after = await capture();
    assert.equal(created.revisions[0].groups[0].assignments[0].employeeId, person.id);
    const added = after.assignments.filter((entry) => !before.assignments.some((old) => old.id === entry.id));
    assert.equal(added.length, 1);
    assert.equal(added[0].objectId, foreignA.object.id);
    assert.equal(added[0].employeeId, person.id);
    assert.equal(added[0].isActive, true);
    const history = after.history.filter((entry) => !before.history.some((old) => old.id === entry.id));
    assert.equal(history.length, 1);
    assert.equal(history[0].createdByUserId, actor.id);
    noActualChange(before, after);
    await audit(foreignA.object.id, 'scheduling_employee_assigned');
    const next = await employee();
    await rule('employees.assignments.manage', 'allow', 'all');
    await rule('objects.staffing.manage', 'deny', 'selected', [foreignA.object.id]);
    await denied(path, 'POST', plan(next.id));
    await revoke('objects.staffing.manage');
    await denied(path, 'POST', plan(next.id));
    await rule('objects.staffing.manage', 'allow', 'all');
    await json(await request(`${root(foreignB.object.id)}/positions`, 'POST', plan(next.id)), 201);
    await denied(path, 'POST', plan(actor.id), 400); // A real User UUID is not an Employee.
  });

  await t.test('pay_conditions.select binds only existing active same-object conditions, never creates/edits amounts', async (suite) => {
    suite.after(reset);
    const f = await fixture('pay-condition');
    const ready = await json<Contour>(await request(`${root(f.object.id)}/contours`, 'POST', { code: 'other', name: 'Other ready condition', dailyRate: 200 }, true), 201);
    await rule('objects.schedules.manage', 'allow', 'all');
    const input = plan(f.person.id, ready.id);
    const path = `${root(f.object.id)}/positions/${f.position.id}`;
    const body = { ...fields(input), expectedVersion: f.position.version };
    await denied(path, 'PUT', body);
    await rule('objects.pay_conditions.select', 'allow', 'selected', [f.object.id]);
    await parentDenials(f.object.id, () => denied(path, 'PUT', body));
    const before = await capture();
    const changed = await json<PositionView>(await request(path, 'PUT', body));
    assert.equal(changed.revisions.at(-1)!.groups[0].timeRanges[0].contourId, ready.id);
    assert.deepEqual(changed.revisions[0], f.position.revisions[0]);
    noActualChange(before, await capture());
    await denied(`${root(f.object.id)}/contours`, 'POST', { code: 'forbidden', name: 'Forbidden amount creation', dailyRate: 999 });
    await denied(`${root(f.object.id)}/contours/${ready.id}`, 'PATCH', { expectedVersion: ready.version, dailyRate: 999 });
    await denied(path, 'PUT', { ...body, expectedVersion: changed.version, dailyRate: 999 }, 400);
    const next = { ...fields(plan(f.person.id, f.contour.id)), expectedVersion: changed.version };
    await rule('objects.pay_conditions.select', 'deny', 'selected', [f.object.id]);
    await denied(path, 'PUT', next);
    await revoke('objects.pay_conditions.select');
    await denied(path, 'PUT', next);
    await rule('objects.pay_conditions.select', 'allow', 'all');
    await denied(path, 'PUT', { ...fields(plan(f.person.id, foreignB.contour.id)), expectedVersion: changed.version }, 400);
    await json(await request(path, 'PUT', next));
    await audit(f.object.id, 'scheduling_position_versioned');
    noActualChange(before, await capture());
  });

  await t.test('attendance.edit confirms/cancels actual shifts with current-cookie revocation, control B and lifecycle guards', async (suite) => {
    suite.after(reset);
    const a = await fixture('actual-A');
    const b = await fixture('actual-B');
    const path = `${root(a.object.id)}/attendance/confirm`;
    const body = confirmation(a);
    await denied(path, 'POST', body);
    await rule('objects.attendance.edit', 'allow', 'selected', [a.object.id]);
    await parentDenials(a.object.id, () => denied(path, 'POST', body));
    await denied(`${root(b.object.id)}/attendance/confirm`, 'POST', confirmation(b));
    const before = await capture();
    const confirmed = await json<Attendance>(await request(path, 'POST', body), 201);
    const after = await capture();
    assert.equal(confirmed.employeeId, a.person.id);
    assert.equal(confirmed.status, 'confirmed');
    assert.equal(confirmed.dailyRateSnapshot, 100); // Existing explicit contour, not a new calculation rule.
    assert.equal(after.shifts.length, before.shifts.length + 1);
    assert.equal(after.shifts.find((entry) => entry.id === confirmed.id)?.createdByUserId, actor.id);
    assert.equal(after.facts.filter((entry) => entry.objectId === a.object.id && entry.employeeId === a.person.id).length, 1);
    assert.deepEqual(after.shifts.filter((entry) => entry.objectId === b.object.id), before.shifts.filter((entry) => entry.objectId === b.object.id));
    assert.deepEqual(after.contours, before.contours);
    assert.deepEqual(after.terms, before.terms);
    assert.deepEqual(after.positions, before.positions);
    await audit(a.object.id, 'scheduling_shift_confirmed');
    const beforeReplay = await capture();
    assert.equal((await json<Attendance>(await request(path, 'POST', body), 201)).id, confirmed.id);
    assert.deepEqual(await capture(), beforeReplay);
    const cancel = `${root(a.object.id)}/attendance/${confirmed.id}/cancel`;
    const cancelBody = { expectedVersion: confirmed.version, reason: 'Actual attendance cancellation' };
    await rule('objects.attendance.edit', 'deny', 'selected', [a.object.id]);
    await denied(cancel, 'POST', cancelBody);
    await revoke('objects.attendance.edit');
    await denied(cancel, 'POST', cancelBody);
    await rule('objects.attendance.edit', 'allow', 'all');
    await denied(path, 'POST', { ...body, requestKey: randomUUID(), operationDate: tomorrow }, 409);
    const cancelled = await json<Attendance>(await request(cancel, 'POST', cancelBody), 201);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.version, confirmed.version + 1);
    const stored = await prisma.objectShiftAttendance.findUniqueOrThrow({ where: { id: confirmed.id } });
    assert.equal(stored.dailyRateSnapshot, 100);
    assert.equal(stored.cancelledByUserId, actor.id);
    assert.equal(stored.cancelReason, cancelBody.reason);
    assert.equal(await prisma.objectAttendanceFact.count({ where: { objectId: a.object.id, employeeId: a.person.id } }), 0);
    await audit(a.object.id, 'scheduling_shift_cancelled');
    const month = await prisma.timesheetMonth.findFirstOrThrow({ where: { objectId: a.object.id } });
    await prisma.timesheetMonth.update({ where: { id: month.id }, data: { status: 'closed' } });
    try { await denied(path, 'POST', { ...body, requestKey: randomUUID() }, 409); }
    finally { await prisma.timesheetMonth.update({ where: { id: month.id }, data: { status: month.status } }); }
  });

  await t.test('scheduling/attendance reads and preview expose plans without manufacturing actual attendance or timesheets', async (suite) => {
    suite.after(reset);
    await rule('objects.schedules.read', 'allow', 'selected', [foreignB.object.id]);
    await rule('objects.attendance.read', 'allow', 'selected', [foreignB.object.id]);
    const before = await capture();
    await json(await request(`${root(foreignB.object.id)}/positions`));
    await json(await request(`${root(foreignB.object.id)}/positions/${foreignB.position.id}`));
    const preview = await json<PreviewResponse>(await request(`${root(foreignB.object.id)}/preview`, 'POST', { from: today, to: today }), 201);
    assert.ok(preview.shifts.some((entry) => entry.employeeId === foreignB.person.id && entry.positionId === foreignB.position.id));
    const actual = await json<{ attendance: Attendance[] }>(await request(`${root(foreignB.object.id)}/attendance?from=${today}&to=${today}`));
    assert.deepEqual(actual.attendance, []);
    assert.deepEqual(await capture(), before);
    await rule('objects.schedules.read', 'deny', 'selected', [foreignB.object.id]);
    await denied(`${root(foreignB.object.id)}/preview`, 'POST', { from: today, to: today });
  });
});
