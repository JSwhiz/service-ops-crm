import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { todayMoscow } from '../src/modules/object-scheduling/scheduling-calendar';
import type { ObjectSetupResponseDto } from '../src/modules/objects/dto/object-setup.dto';
import type { ObjectAuditLogResponseDto } from '../src/modules/objects/dto/object-audit-log-response.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Result = { status: string; adjustmentId: string; approvalRequestId: string | null };

// Main's sequential isolated runner only. Rates/team-fund version writes are
// covered separately in access-control-compensation-writes.integration.test.ts.
// All amounts here are synthetic saved facts, not an OQ-144/OQ-148 formula.
test('object financial rights protect reads, setup versions and independent past decisions', { timeout: 180_000 }, async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.MINIO_ENDPOINT ?? ''));
  assert.equal(process.env.MINIO_USE_SSL, 'false');
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => { try { await closeApp?.(); } finally { await prisma.$disconnect(); } });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const marker = `acl-object-finance-${randomUUID()}`;
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' }, include: { permissions: true } });
  const newUser = async (label: string, roleCode: 'manager' | 'founder') => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    const user = await prisma.user.create({ data: {
      login: `${marker}-${label}`, fullName: `${marker}-${label}`, passwordHash: template.passwordHash, isActive: true,
      roles: { create: { roleId: role.id } },
      ...(roleCode === 'founder' ? { permissions: { create: founder.permissions.map(({ permissionId }) => ({ permissionId })) } } : {}),
    } });
    const cookie = await loginAndGetCookieHeader({ baseUrl, login: user.login, password: 'manager123' });
    return { ...user, cookie };
  };
  const manager = await newUser('assigned', 'manager');
  const outsider = await newUser('unassigned', 'manager');
  const author = await newUser('author', 'founder');
  const reviewer = await newUser('reviewer', 'founder');
  const userIds = [manager.id, outsider.id, author.id, reviewer.id];
  const identities = () => prisma.user.findMany({ where: { id: { in: userIds } }, include: { roles: true, permissions: true }, orderBy: { id: 'asc' } });
  const originalIdentities = await identities();
  // Never log in again after changing rules: these cookies must see fresh ACL.
  const request = (path: string, cookie: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, status = 200): Promise<T> => {
    const body = await response.text();
    assert.equal(response.status, status, body);
    return JSON.parse(body) as T;
  };
  const rule = (userId: string, actionCode: string, effect: 'allow' | 'deny', ids: string[], scope: 'selected' | 'all' = 'selected') => {
    assert.ok(userIds.includes(userId));
    assert.ok(ACCESS_ACTION_CATALOG.find(({ code }) => code === actionCode)?.allowedScopes.includes(scope));
    return prisma.userAccessRule.upsert({ where: { userId_actionCode: { userId, actionCode } },
      create: { userId, actionCode, effect, scope, selectedIds: ids }, update: { effect, scope, selectedIds: ids } });
  };
  const revoke = (userId: string, actionCode: string) => prisma.userAccessRule.deleteMany({ where: { userId, actionCode } });
  const today = todayMoscow();
  const date = (offset: number) => new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  const makeFixture = async () => {
    const employee = await prisma.employee.create({ data: { fullName: `${marker}-${randomUUID()}`, employmentStatus: 'active' } });
    const objects = [];
    for (const label of ['A', 'B']) {
      const object = await prisma.object.create({ data: {
        name: `${marker}-${label}-${randomUUID()}`, address: 'Synthetic isolated financial fixture', status: 'active',
        createdByUserId: author.id, paymentType: 'daily', dailyRate: 5,
        assignments: { create: { userId: manager.id, assignmentRoleCode: 'manager', isActive: true } },
        employeeAssignments: { create: { employeeId: employee.id, isActive: true } },
      } });
      await prisma.objectSetup.create({ data: { objectId: object.id, data: { coefficient: null, contractMonthlyAmount: 11 } } });
      // An unrelated historical manual day must survive every new operation.
      const [year, month, dayOfMonth] = date(-60).split('-').map(Number);
      const container = await prisma.timesheetMonth.create({ data: { objectId: object.id, year, month, createdByUserId: author.id } });
      const row = await prisma.timesheetEmployeeRow.create({ data: { timesheetMonthId: container.id, employeeId: employee.id, employeeNameSnapshot: employee.fullName } });
      const historicalDay = await prisma.timesheetDayEntry.create({ data: {
        rowId: row.id, dayOfMonth, autoValue: 5, manualValue: 7, dayValue: 7, difference: 2,
        isChangedManually: true, ratePolicySnapshot: { ratePolicyType: 'daily_rate', baseAmount: 5 }, createdByUserId: author.id,
      } });
      const historicalCredit = await prisma.objectPayrollCredit.create({ data: {
        objectId: object.id, employeeId: employee.id, operationDate: new Date(`${date(-60)}T00:00:00Z`),
        sourceKey: `historical:${randomUUID()}`, amount: 5, policySnapshot: { ratePolicyType: 'daily_rate', baseAmount: 5 },
        explanation: 'Preserved synthetic past fact', createdByUserId: author.id,
      } });
      objects.push({ ...object, historicalDay, historicalCredit });
    }
    return { a: objects[0], b: objects[1], employee };
  };
  const capture = async (objectId: string) => {
    const adjustments = await prisma.objectCompensationAdjustment.findMany({ where: { objectId }, orderBy: { id: 'asc' } });
    const approvals = await prisma.approvalRequest.findMany({ where: { sourceEntityType: 'object_compensation_adjustment', sourceEntityId: { in: adjustments.map(({ id }) => id) } }, orderBy: { id: 'asc' } });
    return {
      object: await prisma.object.findUniqueOrThrow({ where: { id: objectId } }),
      setup: await prisma.objectSetup.findUniqueOrThrow({ where: { objectId } }),
      versions: await prisma.objectCompensationVersion.findMany({ where: { objectId }, orderBy: { id: 'asc' } }),
      funds: await prisma.objectTeamFundVersion.findMany({ where: { objectId }, orderBy: { id: 'asc' } }),
      credits: await prisma.objectPayrollCredit.findMany({ where: { objectId }, orderBy: { id: 'asc' } }),
      attendance: await prisma.objectAttendanceFact.findMany({ where: { objectId }, orderBy: { id: 'asc' } }),
      shifts: await prisma.objectShiftAttendance.findMany({ where: { objectId }, orderBy: { id: 'asc' } }),
      months: await prisma.timesheetMonth.findMany({ where: { objectId }, orderBy: { id: 'asc' } }),
      rows: await prisma.timesheetEmployeeRow.findMany({ where: { timesheetMonth: { objectId } }, orderBy: { id: 'asc' } }),
      days: await prisma.timesheetDayEntry.findMany({ where: { row: { timesheetMonth: { objectId } } }, orderBy: { id: 'asc' } }),
      objectAudit: await prisma.objectAuditLog.findMany({ where: { objectId }, orderBy: { id: 'asc' } }),
      audit: await prisma.auditEvent.findMany({ where: { OR: [{ entityId: objectId }, { entityType: 'approval_request', entityId: { in: approvals.map(({ id }) => id) } }] }, orderBy: { id: 'asc' } }),
      adjustments, approvals,
    };
  };
  const rejected = async (objectId: string, operation: () => Promise<Response>, status = 403) => {
    const before = await capture(objectId);
    const response = await operation();
    assert.equal(response.status, status, await response.text());
    assert.deepEqual(await capture(objectId), before, 'Rejected HTTP operation must have no business, money or audit effects');
  };
  const setup = (id: string, cookie: string) => request(`/objects/${id}/setup`, cookie);
  const patch = (id: string, body: unknown, cookie = outsider.cookie) => request(`/objects/${id}/setup`, cookie, 'PATCH', body);
  const compensation = (id: string, suffix = '') => `/objects/${id}/scheduling/compensation${suffix}`;
  const input = (employeeId: string, operationDate = today) => ({ requestKey: randomUUID(), kind: 'extra_work', employeeId, operationDate, amount: 3, reason: 'Synthetic bounded extra work' });
  const adjust = (id: string, body: unknown, cookie = manager.cookie) => request(compensation(id, '/adjustments'), cookie, 'POST', body);
  const approve = (id: string, cookie = reviewer.cookie) => request(`/approvals/${id}/approve`, cookie, 'POST', { comment: 'Independent synthetic decision' });
  const historyUnchanged = async (objects: Awaited<ReturnType<typeof makeFixture>>['a'][]) => {
    for (const object of objects) {
      assert.deepEqual(await prisma.timesheetDayEntry.findUniqueOrThrow({ where: { id: object.historicalDay.id } }), object.historicalDay);
      assert.deepEqual(await prisma.objectPayrollCredit.findUniqueOrThrow({ where: { id: object.historicalCredit.id } }), object.historicalCredit);
    }
  };

  await t.test('objects.budget.read and objects.compensation.read keep financial data scoped in the original session', async () => {
    const { a, b } = await makeFixture();
    const budgetCode = 'objects.budget.read';
    const compensationCode = 'objects.compensation.read';
    for (const object of [a, b]) {
      await prisma.objectTeamFundVersion.create({ data: {
        objectId: object.id, version: 1, requestKey: randomUUID(), effectiveFrom: new Date(today),
        monthlyAmount: object.id === a.id ? 11000 : 22000, allocations: [],
        reason: marker, createdByUserId: author.id,
      } });
    }
    const beforeA = await capture(a.id);
    const beforeB = await capture(b.id);
    const readCompensation = (id: string) => request(compensation(id), manager.cookie);
    const readBudget = (id: string) => request(`/objects/${id}/planning`, manager.cookie);
    const funds = async (id: string) => {
      const response = await json<{ teamFunds: Array<{ monthlyAmount: number }> }>(await readCompensation(id));
      return response.teamFunds.map(fund => fund.monthlyAmount);
    };
    assert.deepEqual(await funds(a.id), [11000]);
    assert.deepEqual(await funds(b.id), [22000]);
    await json(await readBudget(a.id));
    await rule(manager.id, budgetCode, 'deny', [a.id]);
    await rejected(a.id, () => readBudget(a.id));
    assert.deepEqual(await funds(a.id), []);
    assert.deepEqual(await funds(b.id), [22000]);
    await json(await readBudget(b.id));
    await revoke(manager.id, budgetCode);
    await json(await readBudget(a.id));
    assert.deepEqual(await funds(a.id), [11000]);

    await rule(manager.id, compensationCode, 'deny', [a.id]);
    await rejected(a.id, () => readCompensation(a.id));
    assert.deepEqual(await funds(b.id), [22000]);
    await revoke(manager.id, compensationCode);
    assert.deepEqual(await funds(a.id), [11000]);
    await rule(manager.id, compensationCode, 'allow', [a.id]);
    await rule(manager.id, 'objects.read', 'deny', [a.id]);
    await rejected(a.id, () => readCompensation(a.id));
    assert.deepEqual(await funds(b.id), [22000]);
    await revoke(manager.id, compensationCode);
    await revoke(manager.id, 'objects.read');
    assert.deepEqual(await capture(a.id), beforeA);
    assert.deepEqual(await capture(b.id), beforeB);
  });

  await t.test('objects.coefficient.edit: selected foreign A, control B, revoke, parents and optimistic setup version', async () => {
    const { a, b } = await makeFixture();
    await rule(outsider.id, 'objects.read', 'allow', [a.id, b.id]);
    for (const object of [a, b]) {
      const view = await json<ObjectSetupResponseDto>(await setup(object.id, outsider.cookie));
      assert.equal(view.capabilities.canEditCoefficient, false);
      await rejected(object.id, () => patch(object.id, { expectedVersion: view.version, coefficient: 1.25 }));
    }
    await rule(outsider.id, 'objects.coefficient.edit', 'allow', [a.id]);
    const view = await json<ObjectSetupResponseDto>(await setup(a.id, outsider.cookie));
    assert.equal(view.capabilities.canEditCoefficient, true);
    const before = await capture(a.id);
    const saved = await json<ObjectSetupResponseDto>(await patch(a.id, { expectedVersion: view.version, coefficient: 1.25 }));
    assert.equal(saved.version, view.version + 1);
    assert.equal(saved.data.coefficient, 1.25);
    const after = await capture(a.id);
    assert.equal((after.setup.data as { coefficient: number }).coefficient, 1.25);
    assert.equal(after.objectAudit.length, before.objectAudit.length + 1);
    assert.equal(after.audit.length, before.audit.length + 1);
    assert.ok(after.objectAudit.some((row) => row.actionCode === 'object.setup.updated' && row.actorUserId === outsider.id));
    assert.ok(after.audit.some((row) => row.action === 'object.setup.updated' && row.actorUserId === outsider.id));
    for (const key of ['object', 'versions', 'funds', 'credits', 'attendance', 'shifts', 'months', 'rows', 'days', 'adjustments', 'approvals'] as const)
      assert.deepEqual(after[key], before[key], `Coefficient storage must not recalculate ${key}`);
    await rejected(a.id, () => patch(a.id, { expectedVersion: view.version, coefficient: 1.5 }), 409);
    await rejected(a.id, () => patch(a.id, { expectedVersion: saved.version, coefficient: 1.5, contractMonthlyAmount: 12 }));
    await rejected(b.id, () => patch(b.id, { expectedVersion: 1, coefficient: 1.5 }));
    await revoke(outsider.id, 'objects.coefficient.edit');
    await rejected(a.id, () => patch(a.id, { expectedVersion: saved.version, coefficient: 1.5 }));
    await rule(manager.id, 'objects.coefficient.edit', 'allow', [a.id, b.id]);
    for (const parent of ['objects.read', 'objects.access']) {
      // Assigned baseline keeps B readable; a deny does not replace a positive read rule.
      await rule(manager.id, parent, 'deny', [a.id]);
      await rejected(a.id, () => patch(a.id, { expectedVersion: saved.version, coefficient: 1.5 }, manager.cookie), 404);
      assert.equal((await setup(b.id, manager.cookie)).status, 200);
      await revoke(manager.id, parent);
    }
    await rule(manager.id, 'objects.coefficient.edit', 'deny', [], 'all');
    for (const object of [a, b]) await rejected(object.id, () => patch(object.id, { expectedVersion: 1, coefficient: 1.5 }, manager.cookie));
    await historyUnchanged([a, b]);
  });

  await t.test('objects.contract_amount.read: HTTP setup/history redaction, selected deny/revoke and leadership-only allow', async () => {
    const { a, b } = await makeFixture();
    const log = await prisma.objectAuditLog.create({ data: {
      objectId: a.id, actorUserId: author.id, actionCode: 'object.updated',
      payload: { before: { contractMonthlyAmount: 11 }, after: [{ nested: { contractAmount: 13 } }], note: marker },
    } });
    const read = async (cookie: string, visible: boolean) => {
      const before = await capture(a.id);
      const view = await json<ObjectSetupResponseDto>(await setup(a.id, cookie));
      assert.equal(view.capabilities.canViewContractAmount, visible);
      assert.equal(view.data.contractMonthlyAmount, visible ? 11 : null);
      const logs = await json<ObjectAuditLogResponseDto[]>(await request(`/objects/${a.id}/audit`, cookie));
      assert.deepEqual(logs.find(({ id }) => id === log.id)?.payload, visible
        ? { before: { contractMonthlyAmount: 11 }, after: [{ nested: { contractAmount: 13 } }], note: marker }
        : { before: {}, after: [{ nested: {} }], note: marker });
      assert.deepEqual(await capture(a.id), before, 'Redacted reads must not rewrite stored amounts/history');
    };
    await read(reviewer.cookie, true);
    await read(manager.cookie, false);
    assert.equal(ACCESS_ACTION_CATALOG.find(({ code }) => code === 'objects.contract_amount.read')?.constraint, 'leadership_only');
    // Catalog allows storing this manageable rule; effective access stays constrained.
    await rule(manager.id, 'objects.contract_amount.read', 'allow', [a.id]);
    await read(manager.cookie, false);
    await rule(reviewer.id, 'objects.contract_amount.read', 'deny', [a.id]);
    await read(reviewer.cookie, false);
    assert.equal((await json<ObjectSetupResponseDto>(await setup(b.id, reviewer.cookie))).data.contractMonthlyAmount, 11);
    await revoke(reviewer.id, 'objects.contract_amount.read');
    await read(reviewer.cookie, true);
    await rule(reviewer.id, 'objects.contract_amount.read', 'deny', [], 'all');
    for (const object of [a, b]) assert.equal((await json<ObjectSetupResponseDto>(await setup(object.id, reviewer.cookie))).data.contractMonthlyAmount, null);
    await revoke(reviewer.id, 'objects.contract_amount.read');
    for (const parent of ['objects.read', 'objects.access']) {
      await rule(reviewer.id, parent, 'deny', [a.id]);
      await rejected(a.id, () => setup(a.id, reviewer.cookie), 404);
      await rejected(a.id, () => request(`/objects/${a.id}/audit`, reviewer.cookie), 404);
      assert.equal((await setup(b.id, reviewer.cookie)).status, 200);
      await revoke(reviewer.id, parent);
    }
  });

  await t.test('objects.compensation.adjust: assigned baseline, selected denial, replay, parent gates and no assignment escalation', async () => {
    const { a, b, employee } = await makeFixture();
    await rule(outsider.id, 'objects.read', 'allow', [a.id, b.id]);
    await rule(outsider.id, 'objects.compensation.adjust', 'allow', [a.id]);
    await rejected(a.id, () => adjust(a.id, input(employee.id), outsider.cookie));
    const original = input(employee.id);
    await rule(manager.id, 'objects.compensation.adjust', 'allow', [a.id]);
    const before = await capture(a.id);
    const result = await json<Result>(await adjust(a.id, original), 201);
    assert.equal(result.status, 'applied');
    assert.equal(result.approvalRequestId, null);
    const after = await capture(a.id);
    const credit = after.credits.find(({ sourceKey }) => sourceKey === `extra:${result.adjustmentId}`)!;
    assert.equal(credit.amount, 3);
    assert.equal(credit.employeeId, employee.id);
    assert.equal(after.adjustments.find(({ id }) => id === result.adjustmentId)?.createdByUserId, manager.id);
    assert.equal(after.adjustments.find(({ id }) => id === result.adjustmentId)?.appliedByUserId, manager.id);
    assert.equal(after.credits.length, before.credits.length + 1);
    assert.equal(after.days.reduce((sum, day) => sum + day.autoValue, 0) - before.days.reduce((sum, day) => sum + day.autoValue, 0), 3);
    assert.equal(after.objectAudit.length, before.objectAudit.length + 1);
    assert.equal(after.audit.length, before.audit.length + 1);
    assert.ok(after.objectAudit.some(({ actionCode, actorUserId }) => actionCode === 'compensation.adjustment.applied' && actorUserId === manager.id));
    assert.ok(after.audit.some(({ action, actorUserId }) => action === 'compensation.adjustment.applied' && actorUserId === manager.id));
    assert.equal((await json<Result>(await adjust(a.id, original), 201)).adjustmentId, result.adjustmentId);
    assert.deepEqual(await capture(a.id), after, 'Replay must not double count money or audit');
    await rejected(a.id, () => adjust(a.id, { ...original, amount: 4 }), 409);
    await rule(manager.id, 'objects.compensation.adjust', 'deny', [a.id]);
    await rejected(a.id, () => adjust(a.id, original));
    await rejected(a.id, () => adjust(a.id, input(employee.id)));
    assert.equal((await json<Result>(await adjust(b.id, input(employee.id)), 201)).status, 'applied');
    await revoke(manager.id, 'objects.compensation.adjust');
    // Revoke returns to assigned manager inheritance, not a fictional default deny.
    assert.equal((await json<Result>(await adjust(a.id, input(employee.id)), 201)).status, 'applied');
    for (const parent of ['objects.read', 'objects.access', 'objects.compensation.manage', 'objects.rates.read', 'objects.budget.read']) {
      await rule(manager.id, parent, 'deny', [a.id]);
      await rejected(a.id, () => adjust(a.id, input(employee.id)));
      await revoke(manager.id, parent);
    }
    await rule(manager.id, 'objects.compensation.adjust', 'deny', [], 'all');
    for (const object of [a, b]) await rejected(object.id, () => adjust(object.id, input(employee.id)));
    await revoke(manager.id, 'objects.compensation.adjust');
    await historyUnchanged([a, b]);
  });

  await t.test('objects.compensation.correct_past: pending real source, independent reviewer, locked resolver and stale credit conflict', async () => {
    const { a, b, employee } = await makeFixture();
    const money = async (id: string) => {
      const state = await capture(id);
      return { credits: state.credits, days: state.days, attendance: state.attendance, shifts: state.shifts };
    };
    const beforePending = await money(a.id);
    // Author is a leader: self-approval denial cannot be explained by a missing role.
    const original = input(employee.id, date(-1));
    const pending = await json<Result>(await adjust(a.id, original, author.cookie), 201);
    const control = await json<Result>(await adjust(b.id, input(employee.id, date(-1)), author.cookie), 201);
    assert.equal(pending.status, 'pending');
    assert.ok(pending.approvalRequestId && control.approvalRequestId);
    assert.deepEqual(await money(a.id), beforePending, 'Past request must not apply money before approval');
    const approval = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: pending.approvalRequestId } });
    assert.equal(approval.sourceEntityId, pending.adjustmentId);
    assert.equal(approval.sourceEntityType, 'object_compensation_adjustment');
    assert.equal((approval.payloadSnapshot as { independentLeadershipRequired: boolean }).independentLeadershipRequired, true);
    await rule(author.id, 'objects.compensation.correct_past', 'allow', [], 'all');
    await rejected(a.id, () => approve(pending.approvalRequestId!, author.cookie));
    await rule(manager.id, 'objects.compensation.correct_past', 'allow', [], 'all');
    await rejected(a.id, () => approve(pending.approvalRequestId!, manager.cookie));
    await rule(reviewer.id, 'objects.compensation.correct_past', 'deny', [], 'all');
    await rejected(a.id, () => approve(pending.approvalRequestId!));
    await rejected(b.id, () => approve(control.approvalRequestId!));
    await revoke(reviewer.id, 'objects.compensation.correct_past');
    await rule(reviewer.id, 'objects.compensation.correct_past', 'deny', [a.id]);
    await rejected(a.id, () => approve(pending.approvalRequestId!));
    await json(await approve(control.approvalRequestId!), 200);
    await revoke(reviewer.id, 'objects.compensation.correct_past');
    for (const parent of ['objects.read', 'objects.access', 'objects.compensation.manage']) {
      await rule(reviewer.id, parent, 'deny', [a.id]);
      await rejected(a.id, () => approve(pending.approvalRequestId!));
      await revoke(reviewer.id, parent);
    }
    await rule(reviewer.id, 'objects.compensation.correct_past', 'allow', [a.id]);
    const beforeApply = await capture(a.id);
    await json(await approve(pending.approvalRequestId!), 200);
    const applied = await capture(a.id);
    const credit = applied.credits.find(({ sourceKey }) => sourceKey === `extra:${pending.adjustmentId}`)!;
    assert.equal(credit.amount, 3);
    const source = applied.adjustments.find(({ id }) => id === pending.adjustmentId)!;
    assert.equal(source.createdByUserId, author.id);
    assert.equal(source.appliedByUserId, reviewer.id);
    assert.equal(source.status, 'applied');
    assert.equal(applied.approvals.find(({ id }) => id === pending.approvalRequestId)?.status, 'approved');
    assert.equal(applied.credits.length, beforeApply.credits.length + 1);
    assert.ok(applied.objectAudit.some(({ actionCode, actorUserId }) => actionCode === 'compensation.adjustment.applied' && actorUserId === reviewer.id));
    assert.ok(applied.audit.some(({ action, actorUserId }) => action === 'compensation.adjustment.applied' && actorUserId === reviewer.id));
    assert.equal((await json<Result>(await adjust(a.id, original, author.cookie), 201)).adjustmentId, pending.adjustmentId);
    assert.deepEqual(await capture(a.id), applied, 'Approved request replay must not add credits or audit');
    await rejected(a.id, () => approve(pending.approvalRequestId!), 409);
    const correct = (body: unknown) => request(compensation(a.id, `/adjustments/${pending.adjustmentId}/correct`), author.cookie, 'POST', body);
    const correction = (amount: number) => ({ requestKey: randomUUID(), expectedCreditUpdatedAt: credit.updatedAt.toISOString(), amount, reason: 'Synthetic correction of one saved credit' });
    const firstInput = correction(4);
    // correct_past alone cannot create a correction: this HTTP route uses adjust.
    await rule(author.id, 'objects.compensation.adjust', 'deny', [a.id]);
    await rejected(a.id, () => correct(firstInput));
    await revoke(author.id, 'objects.compensation.adjust');
    const first = await json<Result>(await correct(firstInput), 201);
    const stale = await json<Result>(await correct(correction(6)), 201);
    assert.equal(first.status, 'pending');
    assert.equal(stale.status, 'pending');
    assert.deepEqual(await money(a.id), { credits: applied.credits, days: applied.days, attendance: applied.attendance, shifts: applied.shifts });
    await json(await approve(first.approvalRequestId!), 200);
    const corrected = await capture(a.id);
    assert.equal(corrected.credits.length, applied.credits.length, 'Correction updates the same credit, never adds another source');
    assert.equal(corrected.credits.find(({ id }) => id === credit.id)?.amount, 4);
    assert.equal(corrected.days.reduce((sum, day) => sum + day.autoValue, 0) - applied.days.reduce((sum, day) => sum + day.autoValue, 0), 1);
    assert.equal(corrected.adjustments.find(({ id }) => id === first.adjustmentId)?.appliedByUserId, reviewer.id);
    assert.deepEqual(corrected.adjustments.find(({ id }) => id === pending.adjustmentId), source, 'Original applied request remains immutable');
    await rejected(a.id, () => approve(stale.approvalRequestId!), 409);
    await rejected(a.id, () => correct(correction(8)), 409);
    assert.equal((await json<Result>(await correct(firstInput), 201)).adjustmentId, first.adjustmentId);
    assert.deepEqual(await capture(a.id), corrected);
    await historyUnchanged([a, b]);

    // This resolver is policy-locked: preview must reject, not save an escalation.
    const locked = ACCESS_ACTION_CATALOG.find(({ code }) => code === 'approvals.resolve_timesheet')!;
    assert.equal(locked.manageable, false);
    const accessState = async () => ({
      user: await prisma.user.findUniqueOrThrow({ where: { id: manager.id } }),
      rules: await prisma.userAccessRule.findMany({ where: { userId: manager.id }, orderBy: { id: 'asc' } }),
      audits: await prisma.userAccessAudit.findMany({ where: { userId: manager.id }, orderBy: { id: 'asc' } }),
      previews: await prisma.userAccessPreview.findMany({ where: { userId: manager.id }, orderBy: { id: 'asc' } }),
    });
    const accessBefore = await accessState();
    const response = await request(`/users-access/admin/users/${manager.id}/preview`, reviewer.cookie, 'POST', {
      expectedVersion: accessBefore.user.accessVersion, reason: 'Must reject a policy-locked resolver',
      changes: [{ actionCode: locked.code, effect: 'allow', scope: 'all' }],
    });
    assert.equal(response.status, 400, await response.clone().text());
    assert.match(await response.text(), /constrained/);
    assert.deepEqual(await accessState(), accessBefore);
  });
  assert.deepEqual(await identities(), originalIdentities, 'Personal rules must not change roles, permissions or user identity');
});
