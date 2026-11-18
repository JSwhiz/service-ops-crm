import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { EmployeeResponseDto } from '../src/modules/employees/dto/employee-response.dto';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('employee lifecycle personal grants preserve scope, dependency guards and history over HTTP', async (t) => {
  // Fail before constructing a client or app. Only main's local isolated runner
  // may execute these fixtures; a shared database/schema is never a fallback.
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname));
  assert.equal(databaseUrl.port, '55432');
  assert.match(databaseUrl.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => {
    try { await closeApp?.(); } finally { await prisma.$disconnect(); }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const actorQuery = { where: { login: 'manager1' }, include: {
    roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    permissions: { include: { permission: true } },
  } } as const;
  const actor = await prisma.user.findUniqueOrThrow(actorQuery);
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  assert.deepEqual(actor.roles.map(({ role }) => role.code), ['manager']);
  const permissionCodes = [...actor.permissions.map(({ permission }) => permission.code),
    ...actor.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code))];
  assert.deepEqual(permissionCodes.filter((code) => code.startsWith('employees.')).sort(), ['employees.view']);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id, actionCode: { startsWith: 'employees.' } } }), 0);
  // Seeded account, one login, no changes to roles/legacy permissions.
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const marker = `acl-employee-lifecycle-${randomUUID()}`;
  const object = await prisma.object.create({ data: {
    name: marker, address: 'Local lifecycle acceptance fixture', status: 'active', createdByUserId: founder.id,
  } });
  const objectBefore = await prisma.object.findUniqueOrThrow({ where: { id: object.id } });
  assert.equal(await prisma.objectAssignment.count({ where: { objectId: object.id, userId: actor.id } }), 0);
  const employeeIds: string[] = [];
  const employee = async (label: string, archived = false) => {
    const row = await prisma.employee.create({ data: {
      fullName: `${marker}-${label}`, employmentStatus: 'active',
      deletedAt: archived ? new Date('2025-04-01T00:00:00Z') : null,
    } });
    employeeIds.push(row.id); // Keep deleted IDs in audit/dependency snapshots.
    return row;
  };
  const ruleIds = new Set<string>();
  const rule = async (actionCode: string, effect: 'allow' | 'deny', selectedIds: string[]) => {
    const saved = await prisma.userAccessRule.create({ data: {
      userId: actor.id, actionCode, effect, scope: 'selected', selectedIds,
    } });
    ruleIds.add(saved.id);
    return saved;
  };
  const removeRule = async (id: string) => {
    await prisma.userAccessRule.delete({ where: { id } });
    ruleIds.delete(id);
  };
  const resetRules = async () => {
    for (const id of [...ruleIds]) await removeRule(id);
  };
  const request = (path: string, body?: unknown) => fetch(`${baseUrl}/api/v1/employees${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const status = async (response: Response, expected: number) => {
    assert.equal(response.status, expected, await response.clone().text());
  };
  const read = async (id: string) => {
    const response = await request(`/${id}`);
    await status(response, 200);
    return await response.json() as EmployeeResponseDto;
  };
  const capture = async () => {
    const where = { employeeId: { in: employeeIds } };
    const [employees, assignments, history, availability, substitutions, attendance, timesheet, exceptions, credits, audit] = await Promise.all([
      prisma.employee.findMany({ where: { id: { in: employeeIds } }, orderBy: { id: 'asc' } }),
      prisma.objectEmployeeAssignment.findMany({ where, orderBy: { id: 'asc' } }),
      prisma.employeeObjectAssignmentHistory.findMany({ where, orderBy: { id: 'asc' } }),
      prisma.employeeAvailabilityWindow.findMany({ where, orderBy: { id: 'asc' } }),
      prisma.employeeSubstitution.findMany({ where: { OR: [where, { substituteEmployeeId: { in: employeeIds } }] }, orderBy: { id: 'asc' } }),
      prisma.objectAttendanceFact.findMany({ where, orderBy: { id: 'asc' } }),
      prisma.timesheetEmployeeRow.findMany({ where, include: { entries: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } }),
      prisma.timesheetManualException.findMany({ where, orderBy: { id: 'asc' } }),
      prisma.objectPayrollCredit.findMany({ where, orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ where: { entityType: 'employee', entityId: { in: employeeIds } }, orderBy: { id: 'asc' } }),
    ]);
    return { employees, assignments, history, availability, substitutions, attendance, timesheet, exceptions, credits, audit };
  };
  const rejected = async (path: string, body: unknown, expected = 403, code?: string, blockerCodes?: string[]) => {
    const before = await capture();
    const response = await request(path, body);
    await status(response, expected);
    if (code) {
      const result = await response.json() as { code: string; blockers?: Array<{ code: string; count: number }> };
      assert.equal(result.code, code);
      if (blockerCodes) assert.deepEqual(result.blockers?.map((row) => ({ code: row.code, count: row.count })).sort((a, b) => a.code.localeCompare(b.code)),
        blockerCodes.map((code) => ({ code, count: 1 })).sort((a, b) => a.code.localeCompare(b.code)));
    }
    assert.deepEqual(await capture(), before, `${path}: rejected requests must not change records or audit`);
  };
  const assignment = async (employeeId: string, start: string, end: string | null) => {
    const canonical = await prisma.objectEmployeeAssignment.create({ data: {
      employeeId, objectId: object.id, startDate: new Date(start), endDate: end ? new Date(end) : null, isActive: !end,
    } });
    const history = await prisma.employeeObjectAssignmentHistory.create({ data: {
      employeeId, objectId: object.id, startedAt: new Date(start), endedAt: end ? new Date(end) : null,
      createdByUserId: founder.id, closedByUserId: end ? founder.id : null,
    } });
    return { canonical, history };
  };
  const start = '2025-01-01T00:00:00Z';
  const end = '2025-01-31T23:59:59Z';

  for (const operation of ['archive', 'restore', 'delete_permanently', 'assignments.delete_as_error'] as const) {
    const actionCode = `employees.${operation}`;
    await t.test(`${actionCode}: selected grant, control B, revocation and lifecycle/history invariants`, async (suite) => {
      suite.after(resetRules);
      const a = await employee(`${operation}-A`, operation === 'restore');
      const b = await employee(`${operation}-B`, operation === 'restore');
      const protectedA = await employee(`${operation}-protected-A`);
      const selectedIds = [a.id, protectedA.id];
      const histories = new Map<string, string>();
      let newer: Awaited<ReturnType<typeof assignment>> | undefined;
      if (operation === 'assignments.delete_as_error') {
        for (const person of [a, b, protectedA]) {
          const saved = await assignment(person.id, start, end);
          histories.set(person.id, saved.history.id);
        }
        // A's old history is erroneous, but a later canonical lifecycle is real.
        await prisma.objectEmployeeAssignment.deleteMany({ where: { employeeId: a.id, objectId: object.id } });
        newer = await assignment(a.id, '2025-03-01T00:00:00Z', null);
        await prisma.objectAttendanceFact.create({ data: {
          employeeId: a.id, objectId: object.id, operationDate: new Date('2025-03-15T12:00:00Z'), dailyRateSnapshot: 1500,
        } });
        await prisma.objectAttendanceFact.create({ data: {
          employeeId: protectedA.id, objectId: object.id, operationDate: new Date('2025-01-15T12:00:00Z'), dailyRateSnapshot: 1200,
        } });
      }
      if (operation === 'archive') await assignment(protectedA.id, start, null);
      if (operation === 'restore') {
        // Restoring an archived card must not reactivate its ended staffing.
        await assignment(a.id, start, end);
      }
      if (operation === 'delete_permanently') {
        const counterpart = await employee('dependency-counterpart');
        await assignment(protectedA.id, start, end);
        await prisma.employeeAvailabilityWindow.create({ data: {
          employeeId: protectedA.id, startDate: new Date(start), availabilityStatus: 'unavailable', createdByUserId: founder.id,
        } });
        for (const [primary, replacement] of [[protectedA.id, counterpart.id], [counterpart.id, protectedA.id]]) {
          await prisma.employeeSubstitution.create({ data: {
            employeeId: primary, substituteEmployeeId: replacement, objectId: object.id,
            startDate: new Date('2025-01-10T00:00:00Z'), endDate: new Date('2025-01-11T00:00:00Z'),
            status: 'completed', reason: 'Protected historical substitution', createdByUserId: founder.id,
          } });
        }
        await prisma.objectAttendanceFact.create({ data: {
          employeeId: protectedA.id, objectId: object.id, operationDate: new Date('2025-01-15T12:00:00Z'), dailyRateSnapshot: 1200,
        } });
        const month = await prisma.timesheetMonth.create({ data: { objectId: object.id, year: 2025, month: 1, createdByUserId: founder.id } });
        await prisma.timesheetEmployeeRow.create({ data: {
          timesheetMonthId: month.id, employeeId: protectedA.id, employeeNameSnapshot: protectedA.fullName,
          entries: { create: { dayOfMonth: 15, autoValue: 1200, dayValue: 1300, manualValue: 1300,
            difference: 100, isChangedManually: true, comment: 'Historical snapshot', createdByUserId: founder.id } },
        } });
        await prisma.timesheetManualException.create({ data: {
          objectId: object.id, employeeId: protectedA.id, year: 2025, month: 1, dayOfMonth: 16,
          requestedDayValue: 1400, currentDayValueSnapshot: 1200, comment: 'Protected pending history', requestedByUserId: founder.id,
        } });
      }
      const path = (id: string) => operation === 'assignments.delete_as_error'
        ? `/${id}/object-assignment-history/${histories.get(id)}/delete-as-error`
        : `/${id}/${operation === 'delete_permanently' ? 'delete-permanently' : operation}`;
      const reason = 'Correct an erroneous isolated acceptance record';
      const body = async (id: string) => operation === 'assignments.delete_as_error' ? { reason }
        : { expectedVersion: (await prisma.employee.findUniqueOrThrow({ where: { id } })).version,
          ...(operation === 'delete_permanently' ? { reason } : {}) };
      const capability = { archive: 'canArchive', restore: 'canRestore', delete_permanently: 'canDeletePermanently',
        'assignments.delete_as_error': 'canDeleteAssignmentAsError' }[operation] as keyof EmployeeResponseDto['capabilities'];
      for (const person of [a, b]) {
        assert.equal((await read(person.id)).capabilities[capability], false);
        await rejected(path(person.id), await body(person.id));
      }
      let allow = await rule(actionCode, 'allow', selectedIds);
      assert.equal((await read(a.id)).capabilities[capability], true);
      assert.equal((await read(b.id)).capabilities[capability], false);
      await rejected(path(b.id), await body(b.id));
      // No selected lifecycle action may grant a different lifecycle action.
      await rejected(`/${a.id}/${operation === 'archive' ? 'restore' : 'archive'}`, { expectedVersion: a.version });
      await prisma.userAccessRule.update({ where: { id: allow.id }, data: { effect: 'deny' } });
      assert.equal((await read(a.id)).capabilities[capability], false);
      await rejected(path(a.id), await body(a.id));
      await removeRule(allow.id); // default/revoke on the existing cookie
      await rejected(path(a.id), await body(a.id));
      allow = await rule(actionCode, 'allow', selectedIds);
      for (const parentCode of ['employees.access', 'employees.view']) {
        const parent = await rule(parentCode, 'deny', [a.id]);
        await status(await request(`/${a.id}`), 403);
        await rejected(path(a.id), await body(a.id));
        await read(b.id);
        await removeRule(parent.id);
        assert.equal((await read(a.id)).capabilities[capability], true);
      }
      if (operation === 'assignments.delete_as_error') {
        const objectDeny = await rule('objects.read', 'deny', [object.id]);
        await rejected(path(a.id), await body(a.id));
        await removeRule(objectDeny.id);
        // Using another employee's existing history must not delete that row.
        await rejected(`/${a.id}/object-assignment-history/${histories.get(b.id)}/delete-as-error`, { reason }, 404);
      } else {
        await rejected(path(a.id), { ...await body(a.id), expectedVersion: a.version + 1 }, 409, 'EMPLOYEE_VERSION_CONFLICT');
      }
      const conflict = { archive: 'EMPLOYEE_HAS_ACTIVE_OBJECT_ASSIGNMENTS', restore: 'EMPLOYEE_NOT_ARCHIVED',
        delete_permanently: 'EMPLOYEE_HAS_OPERATIONAL_HISTORY', 'assignments.delete_as_error': 'ASSIGNMENT_HAS_OPERATIONAL_HISTORY' }[operation];
      const blockerCodes = operation === 'delete_permanently' ? ['object_assignments', 'assignment_history', 'availability_windows',
        'substitutions_primary', 'substitutions_replacement', 'attendance_facts', 'timesheet_rows', 'timesheet_exceptions']
        : operation === 'assignments.delete_as_error' ? ['attendance_facts'] : undefined;
      await rejected(path(protectedA.id), await body(protectedA.id), 409, conflict, blockerCodes);

      const before = await capture();
      const response = await request(path(a.id), await body(a.id));
      await status(response, 201);
      const after = await capture();
      const auditAction = { archive: 'employee.archived', restore: 'employee.restored', delete_permanently: 'employee.deleted_permanently',
        'assignments.delete_as_error': 'employee.object_assignment.deleted_as_error' }[operation];
      const addedAudit = after.audit.filter(({ id }) => !before.audit.some((row) => row.id === id));
      assert.equal(addedAudit.length, 1);
      const event = addedAudit[0];
      assert.equal(event.entityId, a.id);
      assert.equal(event.actorUserId, actor.id);
      assert.equal(event.action, auditAction);
      assert.deepEqual(after.audit.filter(({ id }) => id !== event.id), before.audit);
      if (operation === 'delete_permanently') {
        assert.deepEqual(await response.json(), { success: true });
        assert.equal(await prisma.employee.findUnique({ where: { id: a.id } }), null);
        assert.deepEqual(after.employees, before.employees.filter(({ id }) => id !== a.id));
        assert.equal((event.oldValues as { fullName: string }).fullName, a.fullName);
        assert.equal((event.metadata as { reason: string }).reason, reason);
      } else if (operation === 'assignments.delete_as_error') {
        assert.deepEqual(after.employees, before.employees);
        assert.deepEqual(after.history, before.history.filter(({ id }) => id !== histories.get(a.id)));
        assert.deepEqual(after.assignments, before.assignments, 'Removing old history preserves the newer canonical assignment');
        assert.ok(after.history.some(({ id }) => id === newer!.history.id));
        assert.equal((event.oldValues as { historyId: string }).historyId, histories.get(a.id));
        assert.equal((event.metadata as { reason: string }).reason, reason);
      } else {
        const saved = await prisma.employee.findUniqueOrThrow({ where: { id: a.id } });
        assert.equal(saved.version, a.version + 1);
        assert.equal(Boolean(saved.deletedAt), operation === 'archive');
        assert.deepEqual(saved, { ...a, version: a.version + 1, deletedAt: saved.deletedAt, updatedAt: saved.updatedAt });
        assert.deepEqual(after.employees.filter(({ id }) => id !== a.id), before.employees.filter(({ id }) => id !== a.id));
        assert.equal((event.oldValues as { version: number }).version, a.version);
        assert.equal((event.newValues as { version: number }).version, saved.version);
      }
      for (const key of ['assignments', 'availability', 'substitutions', 'attendance', 'timesheet', 'exceptions', 'credits'] as const)
        assert.deepEqual(after[key], before[key], `${actionCode} must not rewrite staffing or operational/payroll history`);
      if (operation !== 'assignments.delete_as_error') assert.deepEqual(after.history, before.history);
      // Successful-request replay is also forbidden immediately after revocation,
      // including when the deleted resource/history no longer exists.
      await removeRule(allow.id);
      await rejected(path(a.id), operation === 'assignments.delete_as_error' ? { reason } : {
        expectedVersion: a.version, ...(operation === 'delete_permanently' ? { reason } : {}),
      });
      await rejected(path(b.id), await body(b.id));
      await resetRules();
    });
  }
  for (const closed of [false, true]) {
    await t.test(`assignment-error grant removes only a matching ${closed ? 'closed' : 'active'} lifecycle`, async (suite) => {
      suite.after(resetRules);
      const a = await employee(`matching-${closed}-A`);
      const b = await employee(`matching-${closed}-B`);
      const target = await assignment(a.id, start, closed ? end : null);
      await assignment(b.id, start, closed ? end : null);
      await rule('employees.assignments.delete_as_error', 'allow', [a.id]);
      const reason = 'Remove an unused erroneous matching assignment';
      const before = await capture();
      const response = await request(`/${a.id}/object-assignment-history/${target.history.id}/delete-as-error`, { reason });
      await status(response, 201);
      const result = await response.json() as EmployeeResponseDto;
      assert.equal(result.id, a.id);
      assert.equal(result.currentObjectAssignments.length, 0);
      assert.equal(result.objectAssignmentHistory.length, 0);
      const after = await capture();
      assert.deepEqual(after.assignments, before.assignments.filter(({ id }) => id !== target.canonical.id));
      assert.deepEqual(after.history, before.history.filter(({ id }) => id !== target.history.id));
      const added = after.audit.filter(({ id }) => !before.audit.some((row) => row.id === id));
      assert.equal(added.length, 1);
      assert.equal(added[0].actorUserId, actor.id);
      assert.equal(added[0].entityId, a.id);
      assert.equal(added[0].action, 'employee.object_assignment.deleted_as_error');
      assert.equal((added[0].metadata as { reason: string }).reason, reason);
      const old = added[0].oldValues as { historyId: string; currentAssignment: { id: string; isActive: boolean } };
      assert.equal(old.historyId, target.history.id);
      assert.equal(old.currentAssignment.id, target.canonical.id);
      assert.equal(old.currentAssignment.isActive, !closed);
      assert.deepEqual(after.audit.filter(({ id }) => id !== added[0].id), before.audit);
      for (const key of ['employees', 'availability', 'substitutions', 'attendance', 'timesheet', 'exceptions', 'credits'] as const)
        assert.deepEqual(after[key], before[key], 'Matching history deletion preserves other data and control B');
      await resetRules();
    });
  }
  assert.deepEqual(await prisma.user.findUniqueOrThrow(actorQuery), actor, 'Roles and legacy permissions remain untouched');
  assert.deepEqual(await prisma.object.findUniqueOrThrow({ where: { id: object.id } }), objectBefore);
  assert.equal(await prisma.objectAssignment.count({ where: { objectId: object.id, userId: actor.id } }), 0);
  // Main's sequential runner owns and drops the isolated schema and all fixtures.
});
