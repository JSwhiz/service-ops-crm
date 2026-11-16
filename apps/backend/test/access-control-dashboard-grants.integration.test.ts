import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Prisma, PrismaClient } from '@prisma/client';

import type { HrDashboardResponse } from '../src/modules/dashboard/hr-dashboard.service';
import type { LeadershipDashboardResponse } from '../src/modules/dashboard/leadership-dashboard.service';
import type { ManagerDashboardResponse } from '../src/modules/dashboard/manager-dashboard.service';
import type { OperationManagerDashboardResponse } from '../src/modules/dashboard/operation-manager-dashboard.service';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

interface Dashboards {
  leadership: LeadershipDashboardResponse;
  manager: ManagerDashboardResponse;
  hr: HrDashboardResponse;
  operations: OperationManagerDashboardResponse;
}
type Variant = keyof Dashboards;
type Login = 'manager1' | 'hr1' | 'founder';
const variants: Variant[] = ['leadership', 'manager', 'hr', 'operations'];
const routes: Record<Variant, string> = { leadership: 'leadership', manager: 'manager', hr: 'hr', operations: 'operation-manager' };
const keys: Record<Variant, string[]> = {
  leadership: ['generatedAt', 'timeZone', 'attention', 'today', 'tasks', 'money', 'objects', 'orders', 'people'],
  manager: ['generatedAt', 'timeZone', 'scope', 'today', 'attention', 'objects', 'orders', 'tasks'],
  hr: ['generatedAt', 'timeZone', 'today', 'attention', 'candidates', 'employees', 'absences', 'tasks'],
  operations: ['generatedAt', 'timeZone', 'attention', 'today', 'objects', 'tasks', 'orders'],
};

test('all six dashboard actions gate real HTTP DTOs without expanding source rights or changing business data', async (t) => {
  // Main alone executes this through the sequential disposable-schema runner.
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const definitions = ACCESS_ACTION_CATALOG.filter(({ module }) => module === 'dashboard');
  assert.deepEqual(definitions.map(({ code }) => code).sort(), [
    'dashboard.access', 'dashboard.view', ...variants.map((variant) => `dashboard.${variant}.view`),
  ].sort());
  for (const definition of definitions) assert.deepEqual(definition.allowedScopes, ['all']);

  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  let cleanupRules = async (): Promise<void> => {};
  t.after(async () => {
    try { await cleanupRules(); } finally { try { await closeApp?.(); } finally { await prisma.$disconnect(); } }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const actorQuery = { include: {
    roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    permissions: { include: { permission: true } },
  } } as const;
  const actors = {
    manager1: await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' }, ...actorQuery }),
    hr1: await prisma.user.findUniqueOrThrow({ where: { login: 'hr1' }, ...actorQuery }),
    founder: await prisma.user.findUniqueOrThrow({ where: { login: 'founder' }, ...actorQuery }),
  };
  assert.deepEqual(actors.manager1.roles.map(({ role }) => role.code), ['manager']);
  assert.deepEqual(actors.hr1.roles.map(({ role }) => role.code), ['hr']);
  assert.deepEqual(actors.founder.roles.map(({ role }) => role.code), ['founder']);
  const cookies: Record<Login, string> = {
    manager1: await loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
    hr1: await loginAndGetCookieHeader({ baseUrl, login: 'hr1', password: 'hr123' }),
    founder: await loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' }),
  };
  assert.equal(await prisma.userAccessRule.count({ where: { userId: { in: Object.values(actors).map(({ id }) => id) } } }), 0);
  const marker = `dashboard-grants-${randomUUID()}`;
  const object = await prisma.object.create({ data: {
    name: `${marker}-object`, address: 'Isolated dashboard fixture', status: 'active', createdByUserId: actors.founder.id,
  } });
  const order = await prisma.oneTimeOrder.create({ data: {
    title: `${marker}-order`, executionAddress: 'Isolated dashboard order', status: 'new', contactName: 'Fixture',
    executionStartDate: new Date('2035-04-10T09:00:00Z'), executionEndDate: new Date('2035-04-10T10:00:00Z'), createdByUserId: actors.founder.id,
  } });
  const employee = await prisma.employee.create({ data: { fullName: `000-${marker}-employee`, employmentStatus: 'active' } });
  const candidate = await prisma.candidate.create({ data: { fullName: `${marker}-candidate`, status: 'new', createdByUserId: actors.founder.id } });
  const task = await prisma.task.create({ data: {
    title: `${marker}-task`, priority: 'urgent_important', status: 'in_progress', scopeType: 'personal', visibilityType: 'private',
    dueAt: new Date('2000-01-01T12:00:00Z'), createdByUserId: actors.founder.id,
  } });
  for (const login of ['manager1', 'hr1'] as const) {
    await prisma.objectAssignment.create({ data: { objectId: object.id, userId: actors[login].id, assignmentRoleCode: 'manager' } });
    await prisma.oneTimeOrderAssignment.create({ data: { oneTimeOrderId: order.id, userId: actors[login].id, assignmentRoleCode: 'one_time_manager' } });
    await prisma.taskAssignee.create({ data: { taskId: task.id, userId: actors[login].id } });
  }

  const ruleIds = new Set<string>();
  const rule = async (login: Login, actionCode: string, effect: 'allow' | 'deny' = 'allow', selectedIds?: string[]) => {
    const saved = await prisma.userAccessRule.create({ data: {
      userId: actors[login].id, actionCode, effect, scope: selectedIds ? 'selected' : 'all', selectedIds: selectedIds ?? [],
    } });
    ruleIds.add(saved.id);
    return saved;
  };
  const remove = async (id: string) => { await prisma.userAccessRule.delete({ where: { id } }); ruleIds.delete(id); };
  const reset = async () => { await prisma.userAccessRule.deleteMany({ where: { id: { in: [...ruleIds] } } }); ruleIds.clear(); };
  cleanupRules = reset;
  const request = (login: Login, path: string) => fetch(`${baseUrl}/api/v1${path}`, {
    headers: { Cookie: cookies[login] }, signal: AbortSignal.timeout(15_000),
  });
  const read = async <K extends Variant>(login: Login, variant: K, expanded = false): Promise<Dashboards[K]> => {
    const response = await request(login, `/dashboard/${routes[variant]}${expanded ? '?expanded=true' : ''}`);
    assert.equal(response.status, 200, await response.clone().text());
    const dto = await response.json() as Dashboards[K];
    assert.deepEqual(Object.keys(dto).sort(), [...keys[variant]].sort(), 'Validate the actual variant wire DTO, not only HTTP status');
    assert.equal(dto.timeZone, 'Europe/Moscow');
    assert.ok(Number.isFinite(Date.parse(dto.generatedAt)));
    assert.ok(Array.isArray(dto.attention.items));
    assert.ok(Array.isArray(dto.tasks.items));
    assert.ok(dto.attention.items.length <= (expanded && variant === 'leadership' ? 14 : 5));
    assert.ok(dto.tasks.items.length <= (expanded && variant === 'leadership' ? 14 : 5));
    return dto;
  };
  const denied = async (login: Login, variant: Variant) => {
    const response = await request(login, `/dashboard/${routes[variant]}`);
    assert.equal(response.status, 403, await response.clone().text());
    assert.equal((await response.text()).includes(marker), false, 'Rejected DTO must not contain source fixture values');
  };
  const entry = async (login: Login, expected: boolean) => {
    const response = await request(login, '/auth/me');
    assert.equal(response.status, 200, await response.clone().text());
    const me = await response.json() as { capabilities: { canAccessDashboard: boolean } };
    assert.equal(me.capabilities.canAccessDashboard, expected);
  };
  const capture = async () => {
    const [objects, orders, employees, candidates, tasks, objectAssignments, orderAssignments, staffing, assignees,
      taskHistory, candidateAssignments, attendance, reports, objectAudit, audit, approvals, accounts, funding, expenses, absences] = await Promise.all([
      prisma.object.findMany({ orderBy: { id: 'asc' } }),
      prisma.oneTimeOrder.findMany({ orderBy: { id: 'asc' } }),
      prisma.employee.findMany({ orderBy: { id: 'asc' } }),
      prisma.candidate.findMany({ orderBy: { id: 'asc' } }),
      prisma.task.findMany({ orderBy: { id: 'asc' } }),
      prisma.objectAssignment.findMany({ orderBy: { id: 'asc' } }),
      prisma.oneTimeOrderAssignment.findMany({ orderBy: { id: 'asc' } }),
      prisma.objectEmployeeAssignment.findMany({ orderBy: { id: 'asc' } }),
      prisma.taskAssignee.findMany({ orderBy: { id: 'asc' } }),
      prisma.taskHistoryEvent.findMany({ orderBy: { id: 'asc' } }),
      prisma.candidateManagerAssignment.findMany({ orderBy: { id: 'asc' } }),
      prisma.objectAttendanceFact.findMany({ orderBy: { id: 'asc' } }),
      prisma.objectDailyReport.findMany({ orderBy: { id: 'asc' } }),
      prisma.objectAuditLog.findMany({ orderBy: { id: 'asc' } }),
      prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
      prisma.approvalRequest.findMany({ orderBy: { id: 'asc' } }),
      prisma.accountabilityAccount.findMany({ orderBy: { id: 'asc' } }),
      prisma.accountabilityFunding.findMany({ orderBy: { id: 'asc' } }),
      prisma.accountabilityExpense.findMany({ orderBy: { id: 'asc' } }),
      prisma.$queryRaw(Prisma.sql`SELECT * FROM "user_absences" ORDER BY "id"`),
    ]);
    return { objects, orders, employees, candidates, tasks, objectAssignments, orderAssignments, staffing, assignees,
      taskHistory, candidateAssignments, attendance, reports, objectAudit, audit, approvals, accounts, funding, expenses, absences };
  };
  const before = await capture();
  const noEffects = async () => assert.deepEqual(await capture(), before, 'Dashboard reads/denials must not change business rows, histories, audit, approvals or money');

  for (const code of ['dashboard.access', 'dashboard.view']) await t.test(`${code}: all routes, explicit grant/deny/default/revoke in the original cookie`, async (suite) => {
    suite.after(reset);
    for (const variant of variants) await rule('manager1', `dashboard.${variant}.view`);
    for (const variant of variants) await read('manager1', variant);
    const grant = await rule('manager1', code);
    for (const variant of variants) await read('manager1', variant);
    await entry('manager1', true);
    await prisma.userAccessRule.update({ where: { id: grant.id }, data: { effect: 'deny' } });
    const other = await rule('manager1', code === 'dashboard.access' ? 'dashboard.view' : 'dashboard.access');
    for (const variant of variants) await denied('manager1', variant);
    await entry('manager1', false);
    await remove(other.id); await remove(grant.id);
    // Both general gates default to true. Removing an allow must preserve that baseline.
    for (const variant of variants) await read('manager1', variant);
    const again = await rule('manager1', code);
    await remove(again.id);
    for (const variant of variants) await read('manager1', variant);
    await entry('manager1', true);
    await noEffects();
  });

  const cases: Array<{ variant: Variant; login: Login; control: Variant; native?: Login }> = [
    { variant: 'leadership', login: 'manager1', control: 'manager', native: 'founder' },
    { variant: 'manager', login: 'hr1', control: 'hr', native: 'manager1' },
    { variant: 'hr', login: 'manager1', control: 'manager', native: 'hr1' },
    { variant: 'operations', login: 'manager1', control: 'manager' },
  ];
  for (const operation of cases) await t.test(`dashboard.${operation.variant}.view: real foreign-role expansion, deny/default/revoke and native control`, async (suite) => {
    suite.after(reset);
    const { login, variant } = operation;
    await denied(login, variant); await read(login, operation.control);
    const grant = await rule(login, `dashboard.${variant}.view`);
    await read(login, variant);
    if (variant === 'leadership') await read(login, variant, true);
    await prisma.userAccessRule.update({ where: { id: grant.id }, data: { effect: 'deny' } });
    await denied(login, variant); await read(login, operation.control);
    await remove(grant.id); await denied(login, variant);
    const again = await rule(login, `dashboard.${variant}.view`);
    await read(login, variant); await remove(again.id); await denied(login, variant);
    if (operation.native) {
      await read(operation.native, variant);
      const nativeDeny = await rule(operation.native, `dashboard.${variant}.view`, 'deny');
      await denied(operation.native, variant);
      await remove(nativeDeny.id); await read(operation.native, variant);
    }
    await noEffects();
  });

  const isolatePreviews = async () => {
    // Subtract existing rows only for this actor, so preview bounds cannot hide fixture evidence.
    for (const [code, rows, retained] of [
      ['objects.read', await prisma.object.findMany({ select: { id: true } }), object.id],
      ['one_time_orders.read', await prisma.oneTimeOrder.findMany({ select: { id: true } }), order.id],
      ['tasks.read', await prisma.task.findMany({ select: { id: true } }), task.id],
      ['employees.view', await prisma.employee.findMany({ select: { id: true } }), employee.id],
      ['candidates.view', await prisma.candidate.findMany({ select: { id: true } }), candidate.id],
    ] as const) {
      const ids = rows.filter(({ id }) => id !== retained).map(({ id }) => id);
      if (ids.length) await rule('manager1', code, 'deny', ids);
    }
  };
  const suppressSource = async (actionCode: string) => {
    // There is one persisted rule per user/action. Preserve the selected deny
    // that bounds fixture previews instead of creating a duplicate rule, or
    // dropping that filter when revoking the temporary all-source denial.
    const where = { userId_actionCode: { userId: actors.manager1.id, actionCode } };
    const previous = await prisma.userAccessRule.findUnique({ where });
    if (!previous) {
      const temporary = await rule('manager1', actionCode, 'deny');
      return () => remove(temporary.id);
    }
    assert.ok(ruleIds.has(previous.id), 'Only this test owns the rule being temporarily replaced');
    assert.equal(previous.effect, 'deny');
    assert.equal(previous.scope, 'selected');
    await prisma.userAccessRule.update({ where, data: { effect: 'deny', scope: 'all', selectedIds: [] } });
    return async () => {
      const restored = await prisma.userAccessRule.update({ where, data: {
        effect: previous.effect, scope: previous.scope, selectedIds: previous.selectedIds,
      } });
      assert.equal(restored.id, previous.id);
      assert.equal(restored.effect, previous.effect);
      assert.equal(restored.scope, previous.scope);
      assert.deepEqual(restored.selectedIds, previous.selectedIds);
    };
  };
  for (const variant of variants) await t.test(`${variant} wire sections: source deny strips rows and totals; default restores without dashboard privilege escalation`, async (suite) => {
    suite.after(reset);
    await rule('manager1', `dashboard.${variant}.view`);
    await isolatePreviews();
    const initial = await read('manager1', variant);
    assert.deepEqual(initial.tasks.items.map(({ id }) => id), [task.id]);
    assert.equal(initial.tasks.totalRelevant, 1);
    const restoreTasks = await suppressSource('tasks.read');
    const withoutTasks = await read('manager1', variant);
    assert.deepEqual(withoutTasks.tasks, { totalRelevant: 0, items: [] });
    assert.equal(JSON.stringify(withoutTasks).includes(task.title), false, 'Attention must not retain denied task titles');
    await restoreTasks();
    assert.deepEqual((await read('manager1', variant)).tasks.items.map(({ id }) => id), [task.id]);

    if (variant === 'hr') {
      const allowed = await read('manager1', 'hr');
      assert.deepEqual(allowed.employees.items.map(({ id }) => id), [employee.id]);
      assert.equal(allowed.employees.activeCount, 1);
      assert.deepEqual(allowed.candidates.items.map(({ id }) => id), [candidate.id]);
      assert.equal(allowed.candidates.newCount, 1);
      const restoreEmployees = await suppressSource('employees.view');
      const strippedEmployees = await read('manager1', 'hr');
      assert.deepEqual(strippedEmployees.employees, { activeCount: 0, withoutObjectCount: 0, items: [] });
      assert.equal(strippedEmployees.today.activeEmployees, 0);
      assert.equal(strippedEmployees.today.employeesWithoutObject, 0);
      assert.equal(JSON.stringify(strippedEmployees).includes(employee.fullName), false);
      assert.equal(strippedEmployees.candidates.newCount, 1);
      await restoreEmployees();
      assert.deepEqual((await read('manager1', 'hr')).employees.items.map(({ id }) => id), [employee.id]);
      const restoreCandidates = await suppressSource('candidates.view');
      const strippedCandidates = await read('manager1', 'hr');
      assert.deepEqual(strippedCandidates.candidates, { newCount: 0, inProgressCount: 0, overdueSlaCount: 0, items: [] });
      assert.equal(strippedCandidates.today.newCandidates, 0);
      assert.equal(strippedCandidates.today.overdueCandidateSla, 0);
      assert.equal(JSON.stringify(strippedCandidates).includes(candidate.fullName), false);
      await restoreCandidates();
      assert.deepEqual((await read('manager1', 'hr')).candidates.items.map(({ id }) => id), [candidate.id]);
    } else {
      const allowed = await read('manager1', variant);
      assert.deepEqual(allowed.objects.items.map(({ id }) => id), [object.id]);
      assert.deepEqual(allowed.orders.items.map(({ id }) => id), [order.id]);
      const restoreObjects = await suppressSource('objects.read');
      const strippedObjects = await read('manager1', variant);
      assert.deepEqual(strippedObjects.objects.items, []);
      assert.equal('total' in strippedObjects.objects ? strippedObjects.objects.total : strippedObjects.objects.active, 0);
      assert.equal(JSON.stringify(strippedObjects).includes(object.name), false);
      assert.deepEqual(strippedObjects.orders.items.map(({ id }) => id), [order.id]);
      await restoreObjects();
      assert.deepEqual((await read('manager1', variant)).objects.items.map(({ id }) => id), [object.id]);
      const restoreOrders = await suppressSource('one_time_orders.read');
      const strippedOrders = await read('manager1', variant);
      assert.deepEqual(strippedOrders.orders.items, []);
      assert.equal('total' in strippedOrders.orders ? strippedOrders.orders.total : strippedOrders.orders.totalAccessible, 0);
      assert.equal(JSON.stringify(strippedOrders).includes(order.title), false);
      await restoreOrders();
      assert.deepEqual((await read('manager1', variant)).orders.items.map(({ id }) => id), [order.id]);
      if (variant === 'leadership') {
        const leadership = await read('manager1', 'leadership');
        assert.equal(leadership.people.available, true);
        assert.equal(leadership.people.activeEmployees, 1);
        assert.deepEqual(leadership.money, {
          available: false, submittedExpenses: 0, closingRequestedAccounts: 0, oneTimeOrderReceipts: { count: 0, amount: 0 },
        }, 'A leadership dashboard grant does not grant accountability review');
        const restorePeople = await suppressSource('employees.view');
        const strippedPeople = await read('manager1', 'leadership');
        assert.equal(strippedPeople.people.available, false);
        assert.equal(strippedPeople.people.activeEmployees, 0);
        assert.equal(strippedPeople.people.employeesWithoutActiveObject, 0);
        await restorePeople();
        assert.equal((await read('manager1', 'leadership')).people.available, true);
      }
    }
    await noEffects();
  });

  await noEffects();
  for (const login of ['manager1', 'hr1', 'founder'] as const) {
    assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: actors[login].id }, ...actorQuery }), actors[login], 'Dashboard grants never alter actors, roles or legacy permissions');
  }
  // Direct rule fixtures are not admin-save/browser proof. Operations is tested
  // through a real non-operations actor grant, not a newly invented role.
  // Absence privacy, detailed financial redaction, signals around midnight and races are not certified here.
});
