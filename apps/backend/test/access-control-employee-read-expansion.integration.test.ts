import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { EmployeeAttendanceResponseDto } from '../src/modules/employees/dto/employee-attendance.dto';
import type { EmployeeResponseDto } from '../src/modules/employees/dto/employee-response.dto';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// This is a permission-source fixture, not a claim that a default manager lacks HR read.
// Existing seeded roles inherit employees.view. Preserve the real manager role and
// temporarily remove only its view binding in this disposable schema, restoring it exactly.
// access alone does not grant view; attendance defaults to readable once view is granted.
test('employee read expansion from a permission-denied fixture preserves scope, dependencies and business data', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  let restoreFixture = async (): Promise<void> => {};
  t.after(async () => {
    try { await restoreFixture(); } finally {
      try { await closeApp?.(); } finally { await prisma.$disconnect(); }
    }
  });

  const actorQuery = { where: { login: 'manager1' }, include: {
    roles: { orderBy: { id: 'asc' }, include: { role: { include: { permissions: { orderBy: { id: 'asc' }, include: { permission: true } } } } } },
    permissions: { orderBy: { id: 'asc' }, include: { permission: true } },
  } } as const;
  const actor = await prisma.user.findUniqueOrThrow(actorQuery);
  assert.deepEqual(actor.roles.map(({ role }) => role.code), ['manager']);
  const originalMemberships = await prisma.userRole.findMany({ where: { userId: actor.id }, orderBy: { id: 'asc' } });
  const permission = await prisma.permission.findUniqueOrThrow({ where: { code: 'employees.view' } });
  const inheritedView = await prisma.rolePermission.findMany({
    where: { roleId: { in: originalMemberships.map(({ roleId }) => roleId) }, permissionId: permission.id }, orderBy: { id: 'asc' },
  });
  assert.ok(inheritedView.length > 0, 'Fixture must acknowledge the actual inherited read source');
  const directView = await prisma.userPermission.findMany({ where: { userId: actor.id, permissionId: permission.id }, orderBy: { id: 'asc' } });
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id, actionCode: { startsWith: 'employees.' } } }), 0);
  const ruleIds = new Set<string>();
  const fixturePermissionIds = new Set<string>();
  const resetRules = async () => {
    await prisma.userAccessRule.deleteMany({ where: { id: { in: [...ruleIds] } } });
    ruleIds.clear();
  };
  restoreFixture = async () => {
    await resetRules();
    await prisma.$transaction([
      prisma.userPermission.deleteMany({ where: { id: { in: [...fixturePermissionIds] } } }),
      prisma.rolePermission.createMany({ data: inheritedView, skipDuplicates: true }),
      prisma.userPermission.createMany({ data: directView, skipDuplicates: true }),
    ]);
    fixturePermissionIds.clear();
    assert.deepEqual(await prisma.user.findUniqueOrThrow(actorQuery), actor, 'Restore exact actor, roles and permission sources');
    assert.deepEqual(await prisma.userRole.findMany({ where: { userId: actor.id }, orderBy: { id: 'asc' } }), originalMemberships);
  };
  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { id: { in: inheritedView.map(({ id }) => id) } } }),
    prisma.userPermission.deleteMany({ where: { id: { in: directView.map(({ id }) => id) } } }),
  ]);
  const reduced = await prisma.user.findUniqueOrThrow(actorQuery);
  assert.deepEqual(reduced.roles.map(({ role }) => role.code), ['manager']);
  assert.equal(reduced.permissions.some(({ permission }) => permission.code === 'employees.view'), false);
  assert.equal(reduced.roles.some(({ role }) => role.permissions.some(({ permission }) => permission.code === 'employees.view')), false);

  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const marker = `employee-read-expansion-${randomUUID()}`;
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const object = await prisma.object.create({ data: {
    name: marker, address: 'Isolated employee read fixture', status: 'active', createdByUserId: founder.id,
  } });
  const a = await prisma.employee.create({ data: { fullName: `${marker}-A`, employmentStatus: 'active' } });
  const b = await prisma.employee.create({ data: { fullName: `${marker}-B`, employmentStatus: 'active' } });
  const employeeIds = [a.id, b.id];
  for (const person of [a, b]) await prisma.objectAttendanceFact.create({ data: {
    objectId: object.id, employeeId: person.id, operationDate: new Date('2030-04-12T12:00:00Z'),
    workedHours: person.id === a.id ? 4 : 6, dailyRateSnapshot: 0, createdByUserId: founder.id,
  } });
  const capture = async () => {
    const [employees, attendance, availability, substitutions, assignments, history, audit, timesheet, credits] = await Promise.all([
      prisma.employee.findMany({ where: { id: { in: employeeIds } }, orderBy: { id: 'asc' } }),
      prisma.objectAttendanceFact.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: { id: 'asc' } }),
      prisma.employeeAvailabilityWindow.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: { id: 'asc' } }),
      prisma.employeeSubstitution.findMany({ where: { OR: [{ employeeId: { in: employeeIds } }, { substituteEmployeeId: { in: employeeIds } }] }, orderBy: { id: 'asc' } }),
      prisma.objectEmployeeAssignment.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: { id: 'asc' } }),
      prisma.employeeObjectAssignmentHistory.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ where: { entityType: 'employee', entityId: { in: employeeIds } }, orderBy: { id: 'asc' } }),
      prisma.timesheetEmployeeRow.findMany({ where: { employeeId: { in: employeeIds } }, include: { entries: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } }),
      prisma.objectPayrollCredit.findMany({ where: { employeeId: { in: employeeIds } }, orderBy: { id: 'asc' } }),
    ]);
    return { employees, attendance, availability, substitutions, assignments, history, audit, timesheet, credits };
  };
  const before = await capture();
  const request = (path: string) => fetch(`${baseUrl}/api/v1${path}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(15_000) });
  const json = async <T>(path: string): Promise<T> => {
    const response = await request(path);
    assert.equal(response.status, 200, await response.clone().text());
    return await response.json() as T;
  };
  const denied = async (path: string) => {
    const response = await request(path);
    assert.equal(response.status, 403, await response.clone().text());
    assert.deepEqual(await capture(), before, `Denied GET ${path} must have no business effects`);
  };
  const listPath = `/employees?search=${encodeURIComponent(marker)}&sortBy=fullName&sortOrder=asc`;
  const attendancePath = (id: string) => `/employees/${id}/attendance?year=2030&month=4`;
  const listing = async (ids: string[]) => {
    for (const page of [1, 2]) {
      const result = await json<{ items: Array<{ id: string }>; total: number; totalPages: number; capabilities: { canCreate: boolean } }>(`${listPath}&limit=1&page=${page}`);
      assert.equal(result.total, ids.length);
      assert.equal(result.totalPages, ids.length);
      assert.deepEqual(result.items.map(({ id }) => id), ids.slice(page - 1, page));
      assert.equal(result.capabilities.canCreate, false);
    }
  };
  const card = async (id: string) => {
    const result = await json<EmployeeResponseDto>(`/employees/${id}`);
    assert.equal(result.id, id);
    assert.equal(result.fullName, id === a.id ? a.fullName : b.fullName);
    assert.equal(result.capabilities.canView, true);
    for (const key of ['canEdit', 'canArchive', 'canRestore', 'canDeletePermanently', 'canManageAvailability', 'canManageSubstitutions', 'canManageAssignments'] as const) {
      assert.equal(result.capabilities[key], false, 'Read expansion must not grant HR management');
    }
  };
  const attendance = async (id: string) => {
    const result = await json<EmployeeAttendanceResponseDto>(attendancePath(id));
    assert.deepEqual(result.days.map(({ date, objects }) => ({ date, objects: objects.map(({ objectId, workedHours }) => ({ objectId, workedHours })) })), [
      { date: '2030-04-12', objects: [{ objectId: object.id, workedHours: id === a.id ? 4 : 6 }] },
    ]);
  };
  const baselineDenied = async () => {
    const me = await json<{ roleCodes: string[]; capabilities: { canAccessEmployeesHr: boolean } }>('/auth/me');
    assert.deepEqual(me.roleCodes, ['manager']);
    assert.equal(me.capabilities.canAccessEmployeesHr, false);
    await denied(listPath);
    for (const id of employeeIds) { await denied(`/employees/${id}`); await denied(attendancePath(id)); }
  };
  const rule = async (actionCode: string, effect: 'allow' | 'deny', selectedIds?: string[]) => {
    const saved = await prisma.userAccessRule.create({ data: {
      userId: actor.id, actionCode, effect, scope: selectedIds ? 'selected' : 'all', selectedIds: selectedIds ?? [],
    } });
    ruleIds.add(saved.id);
    return saved;
  };
  const remove = async (id: string) => { await prisma.userAccessRule.delete({ where: { id } }); ruleIds.delete(id); };
  const temporaryRule = async (actionCode: string, effect: 'allow' | 'deny', selectedIds?: string[]) => {
    const previous = await prisma.userAccessRule.findUnique({ where: { userId_actionCode: { userId: actor.id, actionCode } } });
    if (!previous) {
      const created = await rule(actionCode, effect, selectedIds);
      return () => remove(created.id);
    }
    await prisma.userAccessRule.update({ where: { id: previous.id }, data: {
      effect, scope: selectedIds ? 'selected' : 'all', selectedIds: selectedIds ?? [],
    } });
    return async () => { await prisma.userAccessRule.update({ where: { id: previous.id }, data: {
      effect: previous.effect, scope: previous.scope, selectedIds: previous.selectedIds,
    } }); };
  };
  await baselineDenied();

  await t.test('employees.access selected/all remains an entry gate, and cannot manufacture view', async (suite) => {
    suite.after(resetRules);
    for (const scope of ['selected', 'all'] as const) {
      const access = await rule('employees.access', 'allow', scope === 'selected' ? [a.id] : undefined);
      await baselineDenied();
      await remove(access.id);
      await baselineDenied();
    }
    assert.deepEqual(await capture(), before);
  });

  await t.test('employees.view expands selected A/control B and all, then live revoke and parent deny win', async (suite) => {
    suite.after(resetRules);
    await baselineDenied();
    const selected = await rule('employees.view', 'allow', [a.id]);
    await listing([a.id]); await card(a.id); await attendance(a.id);
    await denied(`/employees/${b.id}`); await denied(attendancePath(b.id));
    await remove(selected.id); await baselineDenied();
    const all = await rule('employees.view', 'allow');
    await listing(employeeIds);
    for (const id of employeeIds) { await card(id); await attendance(id); }
    for (const actionCode of ['employees.view', 'employees.access']) {
      const restoreSelected = await temporaryRule(actionCode, 'deny', [a.id]);
      if (actionCode === 'employees.view') {
        // One persisted rule per action: replacing the only all-allow with a
        // selected deny does not retain its positive grant for B. This actor
        // intentionally has no inherited employee-view permission.
        await baselineDenied();
      } else {
        await listing([b.id]); await denied(`/employees/${a.id}`); await denied(attendancePath(a.id));
        await card(b.id); await attendance(b.id);
      }
      await restoreSelected(); await listing(employeeIds); await card(a.id);
      const restoreAll = await temporaryRule(actionCode, 'deny');
      await baselineDenied();
      await restoreAll(); await listing(employeeIds);
    }
    await remove(all.id); await baselineDenied();
    assert.deepEqual(await capture(), before);
  });

  await t.test('attendance leaf respects read prerequisites, additive defaults, selected/all deny and direct-permission restoration', async (suite) => {
    suite.after(resetRules);
    await baselineDenied();
    const leaf = await rule('employees.attendance.read', 'allow', [a.id]);
    await baselineDenied(); // Attendance grant must not bypass the missing employee view prerequisite.
    const selectedView = await rule('employees.view', 'allow', [a.id]);
    await attendance(a.id); await denied(attendancePath(b.id));
    await remove(leaf.id);
    await attendance(a.id); // Default attendance is already allowed once view exists; revoke is additive.
    await remove(selectedView.id); await baselineDenied();

    const direct = await prisma.userPermission.create({ data: { userId: actor.id, permissionId: permission.id } });
    fixturePermissionIds.add(direct.id);
    try {
      await listing(employeeIds); await attendance(a.id); await attendance(b.id);
      const allLeaf = await rule('employees.attendance.read', 'allow');
      await attendance(a.id); await attendance(b.id);
      const restoreSelected = await temporaryRule('employees.attendance.read', 'deny', [a.id]);
      await denied(attendancePath(a.id)); await attendance(b.id); await card(a.id);
      await restoreSelected(); await attendance(a.id);
      const restoreAll = await temporaryRule('employees.attendance.read', 'deny');
      for (const id of employeeIds) { await denied(attendancePath(id)); await card(id); }
      await restoreAll();
      for (const actionCode of ['employees.view', 'employees.access']) {
        const parent = await rule(actionCode, 'deny', [a.id]);
        await denied(attendancePath(a.id)); await attendance(b.id);
        await remove(parent.id);
      }
      await remove(allLeaf.id); await attendance(a.id); await attendance(b.id);
    } finally {
      await prisma.userPermission.delete({ where: { id: direct.id } });
      fixturePermissionIds.delete(direct.id);
    }
    await baselineDenied();
    assert.deepEqual(await capture(), before);
  });
  assert.deepEqual(await capture(), before, 'Read grants/denies never mutate HR, attendance, audit or payroll');
  // Outer cleanup restores every original permission-source row even after failure.
  // No new role, roleless actor, browser/admin-save proof or standalone attendance expansion is claimed.
});
