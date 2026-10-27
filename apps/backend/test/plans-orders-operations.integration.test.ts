import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { VisitPlansModule } from '../src/modules/visit-plans/visit-plans.module';
import { OperationalOverdueService } from '../src/modules/visit-plans/operational-overdue.service';
import { loginAndGetCookieHeader } from './helpers/auth';
import { SEEDED_EMPLOYEE_IDS, createCoreTestObject } from './helpers/core-fixtures';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('plans and order operations preserve personal ACL, history, explicit totals and deadlines', async (t) => {
  assert.ok(usesIsolatedIntegrationDatabase(), 'Run only with the isolated integration runner');
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  // Register the owned module explicitly; parent owns production AppModule wiring.
  const module = await Test.createTestingModule({ imports: [AppModule, VisitPlansModule] }).compile();
  const app = module.createNestApplication();
  t.after(() => app.close());
  await configureApp(app); await app.listen(0);
  const address = app.getHttpServer().address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const users = Object.fromEntries(await Promise.all(['founder', 'manager1', 'manager2', 'lebedev', 'gorbacheva', 'drozdovskiy', 'berendyakov'].map(async (login) => [login, await prisma.user.findUniqueOrThrow({ where: { login } })])));
  for (const [code, logins] of [['visit_plans.manage', ['lebedev', 'gorbacheva']], ['one_time_order.escorts.manage', ['drozdovskiy', 'berendyakov']]] as const) {
    const permission = await prisma.permission.upsert({ where: { code }, create: { code, name: code }, update: {} });
    for (const login of logins) await prisma.userPermission.upsert({ where: { userId_permissionId: { userId: users[login]!.id, permissionId: permission.id } }, create: { userId: users[login]!.id, permissionId: permission.id }, update: {} });
  }
  const cookies = Object.fromEntries(await Promise.all(Object.keys(users).map(async (login) => [login, await loginAndGetCookieHeader({ baseUrl, login, password: login === 'founder' ? 'founder123' : login.startsWith('manager') ? 'manager123' : `${login}123` })])));
  const api = (path: string, login = 'manager1', method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, { method, headers: { Cookie: cookies[login]!, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const json = async <T>(response: Response, status = 200): Promise<T> => { assert.equal(response.status, status, await response.clone().text()); return response.json() as Promise<T>; };
  const { objectId } = await createCoreTestObject(prisma, { includeManagerAssignment: true });
  const order = await prisma.oneTimeOrder.create({ data: { title: 'Combined order integration', executionAddress: 'Test', contactName: 'Client', status: 'in_progress', agreedSum: 1000, linkedObjectId: objectId, createdByUserId: users.founder!.id, assignments: { create: ['manager1', 'drozdovskiy', 'berendyakov'].map((login) => ({ userId: users[login]!.id, assignmentRoleCode: 'one_time_manager', isActive: true })) } } });
  await json(await api(`/one-time-orders/${order.id}/workforce/employees`, 'manager1', 'POST', { employeeId: SEEDED_EMPLOYEE_IDS.ivan }), 201);
  await json(await api(`/one-time-orders/${order.id}/workforce/employees`, 'manager1', 'POST', { employeeId: SEEDED_EMPLOYEE_IDS.sergey }), 201);
  type Plan = { id: string; version: number; reportClosedAt: string | null; entries: Array<{ id: string; isUnplanned: boolean; visitedAt: string | null; createdByUserId: string }> };
  let plan: Plan;

  await t.test('only personal planners mutate; managers read their own plan', async () => {
    const input = { managerUserId: users.manager1!.id, planDate: '2030-01-01', reportDueAt: '2030-01-01T18:00:00+03:00' };
    assert.equal((await api('/visit-plans', 'founder', 'POST', input)).status, 403);
    assert.equal((await api('/visit-plans', 'manager1', 'POST', input)).status, 403);
    assert.equal((await api('/visit-plans', 'lebedev', 'POST', { ...input, planDate: '2030-02-31' })).status, 400);
    plan = await json<Plan>(await api('/visit-plans', 'lebedev', 'POST', input), 201);
    assert.equal((await api('/visit-plans', 'gorbacheva', 'POST', input)).status, 409);
    const own = await json<{ plan: Plan; capabilities: { canManage: boolean } }>(await api('/visit-plans?date=2030-01-01'));
    assert.equal(own.plan.id, plan.id); assert.equal(own.capabilities.canManage, false);
    assert.equal((await api(`/visit-plans?date=2030-01-01&managerUserId=${users.manager1!.id}`, 'manager2')).status, 403);
    assert.equal((await api(`/visit-plans/${plan.id}/history`, 'manager2')).status, 403);
  });

  await t.test('planned and unplanned visits use optimistic versions and preserve actor history', async () => {
    const input = { expectedVersion: plan.version, objectId, isUnplanned: false };
    assert.equal((await api(`/visit-plans/${plan.id}/entries`, 'manager1', 'POST', input)).status, 403);
    const concurrent = await Promise.all([api(`/visit-plans/${plan.id}/entries`, 'lebedev', 'POST', input), api(`/visit-plans/${plan.id}/entries`, 'gorbacheva', 'POST', { expectedVersion: plan.version, clientName: 'Must not overwrite', isUnplanned: true })]);
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [201, 409]);
    plan = await json<Plan>(concurrent.find((result) => result.status === 201)!, 201);
    plan = await json<Plan>(await api(`/visit-plans/${plan.id}/entries`, 'gorbacheva', 'POST', { expectedVersion: plan.version, clientName: 'Unplanned client', isUnplanned: true }), 201);
    const entry = plan.entries.find((row) => row.isUnplanned)!;
    assert.ok(entry); assert.equal(entry.createdByUserId, users.gorbacheva!.id);
    plan = await json<Plan>(await api(`/visit-plans/${plan.id}/entries/${entry.id}/visit`, 'lebedev', 'PATCH', { expectedVersion: plan.version, visited: true, visitReport: 'Visited' }));
    assert.ok(plan.entries.find((row) => row.id === entry.id)?.visitedAt);
    const beforeCount = await prisma.auditEvent.count({ where: { entityType: 'manager_visit_plan', entityId: plan.id } });
    assert.equal((await api(`/visit-plans/${plan.id}/report`, 'manager1', 'PATCH', { expectedVersion: plan.version, report: 'Forbidden', closeReport: true })).status, 403);
    assert.equal(await prisma.auditEvent.count({ where: { entityType: 'manager_visit_plan', entityId: plan.id } }), beforeCount);
    const history = await json<Array<{ actor: { id: string }; action: string }>>(await api(`/visit-plans/${plan.id}/history`));
    assert.ok(history.some((row) => row.action === 'visit_plan.unplanned_added' && row.actor.id === users.gorbacheva!.id));
  });

  await t.test('escort lists are nonempty, personal, order scoped, dated and audited', async () => {
    const input = { operationDate: '2030-01-01', expectedVersion: 0, employeeIds: [SEEDED_EMPLOYEE_IDS.ivan] };
    for (const login of ['founder', 'manager1', 'manager2', 'lebedev']) assert.equal((await api(`/one-time-orders/${order.id}/escorts`, login, 'PUT', input)).status, 403);
    assert.equal((await api(`/one-time-orders/${order.id}/escorts`, 'drozdovskiy', 'PUT', { ...input, employeeIds: [] })).status, 400);
    assert.equal((await api(`/one-time-orders/${order.id}/escorts`, 'drozdovskiy', 'PUT', { ...input, employeeIds: [SEEDED_EMPLOYEE_IDS.alexey] })).status, 400);
    const saved = await json<{ id: string; version: number }>(await api(`/one-time-orders/${order.id}/escorts`, 'drozdovskiy', 'PUT', input));
    assert.equal(saved.version, 1);
    assert.equal((await api(`/one-time-orders/${order.id}/escorts`, 'drozdovskiy', 'PUT', input)).status, 409);
    await json(await api(`/one-time-orders/${order.id}/escorts`, 'berendyakov', 'PUT', { ...input, employeeIds: [SEEDED_EMPLOYEE_IDS.sergey] }));
    const lists = await json<{ items: Array<{ id: string; escort: { id: string } }> }>(await api(`/one-time-orders/${order.id}/escorts?date=2030-01-01`));
    assert.equal(lists.items.length, 2);
    assert.equal(lists.items.find((row) => row.id === saved.id)?.escort.id, users.drozdovskiy!.id);
    assert.equal((await api(`/one-time-orders/${order.id}/escorts?date=2030-01-01`, 'manager2')).status, 403);
    await json(await api(`/one-time-orders/${order.id}/escorts`, 'drozdovskiy', 'PUT', { ...input, expectedVersion: 1, employeeIds: [SEEDED_EMPLOYEE_IDS.ivan, SEEDED_EMPLOYEE_IDS.sergey] }));
    assert.equal(await prisma.auditEvent.count({ where: { entityType: 'one_time_order', entityId: order.id, action: 'one_time_order.escorts_saved' } }), 3);
  });

  await t.test('combined service totals must be explicit and reconcile without rewriting payments', async () => {
    const paymentsBefore = await prisma.oneTimeOrderCompletionPayment.count({ where: { oneTimeOrderId: order.id } });
    const input = { expectedVersion: 0, lines: [{ serviceCode: 'cleaning', amount: 600 }, { serviceCode: 'drycleaning', amount: 400 }] };
    assert.equal((await api(`/one-time-orders/${order.id}/service-lines`, 'manager1', 'PUT', input)).status, 403);
    assert.equal((await api(`/one-time-orders/${order.id}/service-lines`, 'founder', 'PUT', { ...input, lines: [{ serviceCode: 'cleaning', amount: 500 }, { serviceCode: 'drycleaning', amount: 400 }] })).status, 400);
    const saved = await json<{ version: number; isReconciled: boolean; allocatedTotal: number }>(await api(`/one-time-orders/${order.id}/service-lines`, 'founder', 'PUT', input));
    assert.equal(saved.version, 1); assert.equal(saved.isReconciled, true); assert.equal(saved.allocatedTotal, 1000);
    assert.equal((await api(`/one-time-orders/${order.id}/service-lines`, 'founder', 'PUT', input)).status, 409);
    assert.equal((await api(`/one-time-orders/${order.id}`, 'founder', 'PATCH', { agreedSum: 999 })).status, 409);
    assert.equal(await prisma.oneTimeOrderCompletionPayment.count({ where: { oneTimeOrderId: order.id } }), paymentsBefore);
    assert.equal((await prisma.oneTimeOrder.findUniqueOrThrow({ where: { id: order.id } })).agreedSum, 1000);
    const revised = await json<{ agreedSum: number; allocatedTotal: number; version: number }>(await api(`/one-time-orders/${order.id}/service-lines`, 'founder', 'PUT', { expectedVersion: 1, agreedSum: 1200, lines: [{ serviceCode: 'cleaning', amount: 800 }, { serviceCode: 'drycleaning', amount: 400 }] }));
    assert.equal(revised.agreedSum, 1200); assert.equal(revised.allocatedTotal, 1200); assert.equal(revised.version, 2);
    assert.equal(await prisma.oneTimeOrderCompletionPayment.count({ where: { oneTimeOrderId: order.id } }), paymentsBefore);
  });

  await t.test('overdue reminders require explicit deadlines, dedupe concurrently and stop after closure', async () => {
    const worker = app.get(OperationalOverdueService);
    const now = new Date('2030-01-01T16:00:00Z');
    const nullDeadlineOrder = await prisma.oneTimeOrder.create({ data: { title: 'Past execution dates without a deadline', executionAddress: 'Test', contactName: 'Client', status: 'in_progress', executionEndDate: new Date('2000-01-01'), createdByUserId: users.founder!.id, assignments: { create: { userId: users.manager1!.id, assignmentRoleCode: 'one_time_manager' } } } });
    await prisma.oneTimeOrder.update({ where: { id: order.id }, data: { deadlineAt: new Date('2030-01-01T15:00:00Z') } });
    await Promise.all([worker.processOverdue(now), worker.processOverdue(now)]);
    const count = await prisma.notification.count({ where: { entityId: { in: [plan.id, order.id] } } });
    assert.ok(count >= 4);
    await worker.processOverdue(now);
    assert.equal(await prisma.notification.count({ where: { entityId: { in: [plan.id, order.id] } } }), count);
    assert.equal(await prisma.notification.count({ where: { entityId: nullDeadlineOrder.id } }), 0);
    const recipients = await prisma.notification.findMany({ where: { entityId: plan.id } });
    assert.ok(recipients.some((row) => row.recipientUserId === users.manager1!.id));
    assert.ok(recipients.some((row) => row.recipientUserId === users.founder!.id));
    plan = await json<Plan>(await api(`/visit-plans/${plan.id}/report`, 'gorbacheva', 'PATCH', { expectedVersion: plan.version, report: 'Complete', closeReport: true }));
    assert.ok(plan.reportClosedAt);
    await prisma.oneTimeOrder.update({ where: { id: order.id }, data: { status: 'completed', deadlineAt: new Date('2030-01-01T14:00:00Z') } });
    await prisma.managerVisitPlan.update({ where: { id: plan.id }, data: { reportDueAt: new Date('2030-01-01T14:00:00Z') } });
    await worker.processOverdue(now);
    assert.equal(await prisma.notification.count({ where: { entityId: { in: [plan.id, order.id] } } }), count);
    await prisma.oneTimeOrder.update({ where: { id: order.id }, data: { status: 'in_progress' } });
  });

  await t.test('employee payout evidence is optional while independent approval, recipient and audit remain required', async () => {
    const account = await prisma.accountabilityAccount.upsert({ where: { userId: users.manager1!.id }, create: { userId: users.manager1!.id, status: 'active' }, update: {} });
    const payoutInput = { amount: 100, description: 'Employee payout without receipt', oneTimeOrderId: order.id, expenseCategory: 'employee_payout', employeeId: SEEDED_EMPLOYEE_IDS.ivan, oneTimeOrderWorkCycle: 1, expenseDate: '2030-01-01' };
    assert.equal((await api('/accountability/me/expenses', 'manager1', 'POST', { ...payoutInput, employeeId: undefined })).status, 400);
    const payout = await json<{ id: string }>(await api('/accountability/me/expenses', 'manager1', 'POST', payoutInput), 201);
    const ordinary = await json<{ id: string }>(await api('/accountability/me/expenses', 'manager1', 'POST', { amount: 50, description: 'Transport requires evidence', oneTimeOrderId: order.id, expenseCategory: 'transport', expenseDate: '2030-01-01' }), 201);
    assert.equal((await api(`/accountability/me/expenses/${ordinary.id}/submit`, 'manager1', 'POST', {})).status, 409);
    assert.equal(await prisma.fileAttachment.count({ where: { entityType: 'accountability_expense', entityId: payout.id } }), 0);
    assert.equal((await api(`/accountability/me/expenses/${payout.id}/submit`, 'manager2', 'POST', {})).status, 403);
    await json(await api(`/accountability/me/expenses/${payout.id}/submit`, 'manager1', 'POST', {}));
    assert.equal((await api(`/accountability/expenses/${payout.id}/approve`, 'manager1', 'POST', {})).status, 403);
    assert.equal((await prisma.accountabilityExpense.findUniqueOrThrow({ where: { id: payout.id } })).status, 'submitted');
    await json(await api(`/accountability/expenses/${payout.id}/approve`, 'founder', 'POST', {}));
    const saved = await prisma.accountabilityExpense.findUniqueOrThrow({ where: { id: payout.id } });
    assert.equal(saved.status, 'approved'); assert.equal(saved.accountabilityAccountId, account.id); assert.equal(saved.employeeId, SEEDED_EMPLOYEE_IDS.ivan); assert.equal(saved.createdByUserId, users.manager1!.id); assert.equal(saved.amount.toNumber(), 100);
    assert.ok(await prisma.auditEvent.findFirst({ where: { entityType: 'accountability_expense', entityId: payout.id, action: 'accountability_expense_submitted' } }));
  });

  await t.test('report resources reuse scoped reads without granting global inventory or equipment access', async () => {
    for (const suffix of ['inventory', 'equipment']) {
      const path = `/one-time-orders/${order.id}/${suffix}`;
      await json(await api(path));
      assert.ok([403, 404].includes((await api(path, 'manager2')).status), 'unassigned manager cannot read order resources');
    }
    assert.equal((await api('/inventory/items', 'manager1', 'POST', { name: 'Forbidden', category: 'Test', unit: 'шт' })).status, 403);
    assert.equal((await api('/equipment/catalog', 'manager1', 'POST', { name: 'Forbidden', category: 'Test' })).status, 403);
  });
});
