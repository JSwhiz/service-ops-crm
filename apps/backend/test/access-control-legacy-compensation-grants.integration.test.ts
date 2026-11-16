import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { todayMoscow } from '../src/modules/object-scheduling/scheduling-calendar';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Pending = { status: string; adjustmentId: string; approvalRequestId: string | null };

// Historical facts are synthetic fixtures only in the disposable local schema.
// The adjustment and approval are created by the real attendance POST, never by
// inserting a fake kind or bypassing the independent financial approval route.
test('legacy attendance approval honors actual-object financial and parent denies', { timeout: 180_000 }, async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);

  const prisma = new PrismaClient();
  const lifecycle: { close?: () => Promise<void> } = {};
  t.after(async () => { try { await lifecycle.close?.(); } finally { await prisma.$disconnect(); } });
  const { app, baseUrl } = await createTestApp();
  lifecycle.close = () => app.close();
  const marker = `acl-legacy-finance-${randomUUID()}`;
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const newLeader = async (label: string, roleCode: 'founder' | 'director') => {
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    const user = await prisma.user.create({ data: {
      login: `${marker}-${label}`, fullName: `${marker}-${label}`, passwordHash: template.passwordHash, isActive: true,
      roles: { create: { roleId: role.id } },
    } });
    return { ...user, cookie: await loginAndGetCookieHeader({ baseUrl, login: user.login, password: 'manager123' }) };
  };
  const author = await newLeader('author', 'founder');
  const reviewer = await newLeader('independent-reviewer', 'director');
  assert.notEqual(author.id, reviewer.id);
  const identities = () => prisma.user.findMany({ where: { id: { in: [author.id, reviewer.id] } },
    include: { roles: true, permissions: true }, orderBy: { id: 'asc' } });
  const originalIdentities = await identities();
  // Both cookies predate all personal rules. No roles/permissions are changed.
  const request = (path: string, cookie: string, body: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, expected: number): Promise<T> => {
    const body = await response.text();
    assert.equal(response.status, expected, body);
    return JSON.parse(body) as T;
  };
  const operationDate = new Date(Date.parse(`${todayMoscow()}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const [year, month, dayOfMonth] = operationDate.split('-').map(Number);
  const objectIds: string[] = [];
  const makeFixture = async (label: string) => {
    const employee = await prisma.employee.create({ data: { fullName: `${marker}-${label}`, employmentStatus: 'active' } });
    assert.ok(![author.id, reviewer.id].includes(employee.id), 'Employee is not a CRM User');
    const object = await prisma.object.create({ data: {
      name: `${marker}-${label}`, address: 'Isolated legacy attendance regression', status: 'active',
      createdByUserId: author.id, paymentType: 'daily', dailyRate: 1500,
      assignments: { create: { userId: author.id, assignmentRoleCode: 'responsible', isActive: true } },
      employeeAssignments: { create: { employeeId: employee.id, isActive: true } },
    } });
    objectIds.push(object.id);
    await prisma.objectPlanningSettings.create({ data: { objectId: object.id, automaticSeasons: false } });
    const policy = { ratePolicyType: 'daily_rate', baseAmount: 1500 };
    // Match the existing attendance parser's local calendar midnight exactly;
    // this is not a claim that its timezone implementation has been verified.
    const fact = await prisma.objectAttendanceFact.create({ data: {
      objectId: object.id, employeeId: employee.id, operationDate: new Date(year, month - 1, dayOfMonth),
      source: 'legacy', dailyRateSnapshot: 1500, workedHours: 8,
      ratePolicySnapshot: policy, createdByUserId: author.id,
    } });
    const credit = await prisma.objectPayrollCredit.create({ data: {
      objectId: object.id, employeeId: employee.id, operationDate: new Date(`${operationDate}T00:00:00Z`),
      sourceKey: `legacy:${employee.id}:${operationDate}`, amount: 1500,
      policySnapshot: policy, explanation: 'Synthetic saved daily attendance', createdByUserId: author.id,
    } });
    const container = await prisma.timesheetMonth.create({ data: { objectId: object.id, year, month, createdByUserId: author.id } });
    const row = await prisma.timesheetEmployeeRow.create({ data: {
      timesheetMonthId: container.id, employeeId: employee.id, employeeNameSnapshot: employee.fullName,
    } });
    const entry = await prisma.timesheetDayEntry.create({ data: {
      rowId: row.id, dayOfMonth, autoValue: 1500, dayValue: 1500, workedHours: 8,
      isChangedManually: false, ratePolicySnapshot: policy, createdByUserId: author.id,
    } });
    return { object, employee, fact, credit, entry,
      payload: { operationDate, employeeIds: [], comment: `${marker}-${label}: remove a saved past fact` } };
  };
  type Fixture = Awaited<ReturnType<typeof makeFixture>>;
  const capture = async () => {
    const where = { objectId: { in: [...objectIds] } };
    const adjustments = await prisma.objectCompensationAdjustment.findMany({ where, orderBy: { id: 'asc' } });
    return {
      objects: await prisma.object.findMany({ where: { id: { in: [...objectIds] } }, orderBy: { id: 'asc' } }),
      assignments: await prisma.objectAssignment.findMany({ where, orderBy: { id: 'asc' } }),
      employees: await prisma.objectEmployeeAssignment.findMany({ where, orderBy: { id: 'asc' } }),
      planning: await prisma.objectPlanningSettings.findMany({ where, orderBy: { objectId: 'asc' } }),
      versions: await prisma.objectCompensationVersion.findMany({ where, orderBy: { id: 'asc' } }),
      funds: await prisma.objectTeamFundVersion.findMany({ where, orderBy: { id: 'asc' } }),
      credits: await prisma.objectPayrollCredit.findMany({ where, orderBy: { id: 'asc' } }),
      facts: await prisma.objectAttendanceFact.findMany({ where, orderBy: { id: 'asc' } }),
      shifts: await prisma.objectShiftAttendance.findMany({ where, orderBy: { id: 'asc' } }),
      months: await prisma.timesheetMonth.findMany({ where, orderBy: { id: 'asc' } }),
      rows: await prisma.timesheetEmployeeRow.findMany({ where: { timesheetMonth: where }, orderBy: { id: 'asc' } }),
      days: await prisma.timesheetDayEntry.findMany({ where: { row: { timesheetMonth: where } }, orderBy: { id: 'asc' } }),
      adjustments,
      approvals: await prisma.approvalRequest.findMany({ where: {
        sourceEntityType: 'object_compensation_adjustment', sourceEntityId: { in: adjustments.map(({ id }) => id) },
      }, orderBy: { id: 'asc' } }),
      objectAudit: await prisma.objectAuditLog.findMany({ where, orderBy: { id: 'asc' } }),
      audit: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
      notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
      // Delivery-worker transport state is not a business side effect.
      outbox: await prisma.notificationOutbox.findMany({ orderBy: { id: 'asc' }, select: {
        id: true, notificationId: true, recipientUserId: true, createdAt: true,
      } }),
      messages: await prisma.chatMessage.findMany({ orderBy: { id: 'asc' } }),
    };
  };
  const postAttendance = (fixture: Fixture) => request(`/objects/${fixture.object.id}/attendance`, author.cookie, fixture.payload);
  const createPending = async (fixture: Fixture) => {
    const before = await capture();
    const result = await json<Pending>(await postAttendance(fixture), 201);
    assert.equal(result.status, 'pending');
    assert.ok(result.approvalRequestId);
    const after = await capture();
    for (const key of ['credits', 'facts', 'shifts', 'months', 'rows', 'days', 'versions', 'funds'] as const)
      assert.deepEqual(after[key], before[key], `Pending request must not apply ${key}`);
    const adjustment = after.adjustments.find(({ id }) => id === result.adjustmentId);
    assert.ok(adjustment);
    assert.equal(adjustment.kind, 'legacy_attendance');
    assert.equal(adjustment.objectId, fixture.object.id);
    assert.equal(adjustment.createdByUserId, author.id);
    assert.equal(adjustment.status, 'pending');
    const savedBefore = adjustment.beforeSnapshot as { facts: Array<{ id: string }>; holidays: unknown[] };
    assert.deepEqual(savedBefore.facts.map(({ id }) => id), [fixture.fact.id]);
    assert.deepEqual(savedBefore.holidays, []);
    const approval = after.approvals.find(({ id }) => id === result.approvalRequestId);
    assert.ok(approval);
    assert.equal(approval.sourceEntityId, adjustment.id);
    assert.equal(approval.approvalType, 'object_compensation_confirmation');
    assert.equal(approval.status, 'pending');
    assert.equal((approval.payloadSnapshot as { independentLeadershipRequired: boolean }).independentLeadershipRequired, true);
    const beforeReplay = await capture();
    assert.deepEqual(await json<Pending>(await postAttendance(fixture), 201), result);
    assert.deepEqual(await capture(), beforeReplay, 'Same pending attendance request must be idempotent');
    return { ...result, approvalRequestId: result.approvalRequestId };
  };
  const approve = (id: string, cookie = reviewer.cookie) => request(`/approvals/${id}/approve`, cookie, { comment: 'Independent legacy attendance regression review' });
  const rejected = async (id: string, cookie = reviewer.cookie, status = 403) => {
    const before = await capture();
    const response = await approve(id, cookie);
    const body = await response.text();
    assert.equal(response.status, status, body);
    assert.deepEqual(await capture(), before, 'Rejected decision must preserve money, facts, both audits, pending approval and side effects');
    return body;
  };
  const assertApplied = async (fixture: Fixture, pending: Awaited<ReturnType<typeof createPending>>) => {
    const state = await capture();
    const adjustment = state.adjustments.find(({ id }) => id === pending.adjustmentId);
    assert.ok(adjustment);
    assert.equal(adjustment.status, 'applied');
    assert.equal(adjustment.appliedByUserId, reviewer.id);
    assert.equal(state.approvals.find(({ id }) => id === pending.approvalRequestId)?.status, 'approved');
    assert.equal(state.approvals.find(({ id }) => id === pending.approvalRequestId)?.resolvedByUserId, reviewer.id);
    assert.equal(state.facts.filter(({ objectId }) => objectId === fixture.object.id).length, 0);
    const credits = state.credits.filter(({ objectId }) => objectId === fixture.object.id);
    assert.equal(credits.length, 1, 'Removal updates the existing legacy credit, never adds another payout source');
    assert.equal(credits[0].id, fixture.credit.id);
    assert.equal(credits[0].amount, 0);
    const entry = state.days.find(({ id }) => id === fixture.entry.id);
    assert.ok(entry);
    assert.equal(entry.autoValue, 0);
    assert.equal(entry.dayValue, 0);
    assert.equal(entry.isChangedManually, false);
    assert.equal(state.audit.filter(({ entityId, action, actorUserId }) => entityId === fixture.object.id && action === 'object.attendance.updated' && actorUserId === reviewer.id).length, 1);
    assert.equal(state.objectAudit.filter(({ objectId, actionCode, actorUserId }) => objectId === fixture.object.id && actionCode === 'attendance.submitted' && actorUserId === reviewer.id).length, 1);
    assert.equal(state.audit.filter(({ entityId, action, actorUserId }) => entityId === pending.approvalRequestId && action === 'approval.request.approved' && actorUserId === reviewer.id).length, 1);
    const beforeReplay = await capture();
    const replay = await json<Pending>(await postAttendance(fixture), 201);
    assert.equal(replay.status, 'applied');
    assert.equal(replay.adjustmentId, pending.adjustmentId);
    assert.equal(replay.approvalRequestId, pending.approvalRequestId);
    assert.deepEqual(await capture(), beforeReplay, 'Applied attendance replay must not duplicate money or history');
    await rejected(pending.approvalRequestId, reviewer.cookie, 409);
  };

  const a = await makeFixture('A');
  const pendingA = await createPending(a);
  await t.test('independent leadership is mandatory even for the founder author', async () => {
    assert.match(await rejected(pendingA.approvalRequestId, author.cookie), /другой активный пользователь руководящего круга/);
  });
  for (const actionCode of ['objects.compensation.correct_past', 'objects.compensation.manage', 'objects.access', 'objects.read']) {
    await t.test(`${actionCode}: selected deny A preserves all effects while real B remains approvable`, async () => {
      const definition = ACCESS_ACTION_CATALOG.find(({ code }) => code === actionCode);
      assert.ok(definition);
      assert.ok(definition.allowedScopes.includes('selected'));
      const b = await makeFixture(`B-${actionCode}`);
      const pendingB = await createPending(b);
      const rule = await prisma.userAccessRule.create({ data: {
        userId: reviewer.id, actionCode, effect: 'deny', scope: 'selected', selectedIds: [a.object.id],
      } });
      assert.notEqual(a.object.id, pendingA.adjustmentId);
      assert.notEqual(a.object.id, pendingA.approvalRequestId);
      await rejected(pendingA.approvalRequestId);
      await json(await approve(pendingB.approvalRequestId), 200);
      await assertApplied(b, pendingB);
      assert.equal((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: pendingA.approvalRequestId } })).status, 'pending');
      await prisma.userAccessRule.delete({ where: { id: rule.id } });
    });
  }
  await t.test('revoke restores A through the original cookie, with one application and no replay effects', async () => {
    assert.equal(await prisma.userAccessRule.count({ where: { userId: reviewer.id } }), 0);
    await json(await approve(pendingA.approvalRequestId), 200);
    await assertApplied(a, pendingA);
    assert.deepEqual(await identities(), originalIdentities, 'Personal rules never mutate role, legacy authority or identities');
  });
});
