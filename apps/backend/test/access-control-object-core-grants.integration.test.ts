import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { ObjectResponseDto } from '../src/modules/objects/dto/object-response.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Scope = 'own' | 'assigned' | 'selected' | 'all';
type Status = 'active' | 'frozen' | 'archived';

// Intentionally bounded to core actions. No claim of full objects.* acceptance.
// Rules are personal DB fixtures, never access-admin mutations or role changes.
test('object core grants enforce live HTTP scope, persistence, audit and pending approval boundaries', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname));
  assert.equal(databaseUrl.port, '55432');
  assert.match(databaseUrl.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);

  const prisma = new PrismaClient();
  const lifecycle: { closeApp?: () => Promise<void> } = {};
  t.after(async () => {
    try { await lifecycle.closeApp?.(); } finally { await prisma.$disconnect(); }
  });
  const { app, baseUrl } = await createTestApp();
  lifecycle.closeApp = () => app.close();
  const marker = `acl-object-core-${randomUUID()}`;
  const cloneUser = async (login: string, roleCode: string) => {
    const template = await prisma.user.findUniqueOrThrow({ where: { login } });
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    return prisma.user.create({ data: {
      login: `${marker}-${roleCode}`, fullName: `${marker} ${roleCode}`,
      passwordHash: template.passwordHash, isActive: true,
      roles: { create: { roleId: role.id } },
    } });
  };
  const actor = await cloneUser('manager1', 'manager');
  const leader = await cloneUser('founder', 'founder');
  const colleague = await prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } });
  // Login exactly once: every later policy change is observed by these old cookies.
  const actorCookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const leaderCookie = await loginAndGetCookieHeader({ baseUrl, login: leader.login, password: 'founder123' });
  const userIds = [actor.id, leader.id];
  let sequence = 0;
  const request = (path: string, method = 'GET', body?: unknown, cookie = actorCookie) => fetch(
    `${baseUrl}/api/v1${path}`, {
      method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const json = async <T,>(response: Response, expected: number): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, expected, text);
    return JSON.parse(text) as T;
  };
  const rule = (suffix: string, effect: 'allow' | 'deny', scope: Scope, selectedIds: string[] = [], userId = actor.id) => {
    const actionCode = `objects.${suffix}`;
    assert.ok(ACCESS_ACTION_CATALOG.find((action) => action.code === actionCode)?.allowedScopes.includes(scope));
    return prisma.userAccessRule.upsert({
      where: { userId_actionCode: { userId, actionCode } },
      create: { userId, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds },
    });
  };
  const revoke = (suffix: string, userId = actor.id) => prisma.userAccessRule.delete({
    where: { userId_actionCode: { userId, actionCode: `objects.${suffix}` } },
  });
  const reset = () => prisma.userAccessRule.deleteMany({ where: {
    userId: { in: userIds }, actionCode: { startsWith: 'objects.' },
  } });
  const fixture = (label: string, status: Status = 'active', owner = leader.id, assigned = true) => prisma.object.create({ data: {
    name: `${marker}-${label}-${++sequence}`, address: 'Isolated object core fixture', status,
    createdByUserId: owner,
    baseCompensationProfile: {
      paymentType: 'daily', dailyRate: 0, monthlySalary: 0,
      paymentScheduleCode: null, paymentScheduleWeekdays: [], paymentScheduleCycleStartDate: null,
    },
    assignments: { create: [
      { userId: leader.id, assignmentRoleCode: 'responsible', isActive: true },
      ...(assigned ? [{ userId: actor.id, assignmentRoleCode: 'manager', isActive: true }] : []),
    ] },
  } });
  // Schema belongs exclusively to the serial integration runner. Snapshot all
  // relevant rows, including unknown IDs from a failed create, not just known A/B.
  const snapshot = async () => ({
    objects: await prisma.object.findMany({ orderBy: { id: 'asc' } }),
    assignments: await prisma.objectAssignment.findMany({ orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ orderBy: { id: 'asc' } }),
    audits: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    objectAudits: await prisma.objectAuditLog.findMany({ orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    // Delivery timestamps can advance independently in the background worker.
    // Preserve durable outbox identities/content while excluding delivery state.
    outbox: await prisma.notificationOutbox.findMany({ orderBy: { id: 'asc' }, select: {
      id: true, notificationId: true, recipientUserId: true, createdAt: true,
    } }),
    messages: await prisma.chatMessage.findMany({ orderBy: { id: 'asc' } }),
    contacts: await prisma.objectContact.findMany({ orderBy: { id: 'asc' } }),
    setup: await prisma.objectSetup.findMany({ orderBy: { objectId: 'asc' } }),
    planning: await prisma.objectPlanningSettings.findMany({ orderBy: { objectId: 'asc' } }),
    staffing: await prisma.objectEmployeeAssignment.findMany({ orderBy: { id: 'asc' } }),
    attendance: await prisma.objectAttendanceFact.findMany({ orderBy: { id: 'asc' } }),
    inventory: await prisma.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
    equipment: await prisma.equipmentMovement.findMany({ orderBy: { id: 'asc' } }),
  });
  type Snapshot = Awaited<ReturnType<typeof snapshot>>;
  const denied = async (path: string, method = 'GET', body?: unknown, status = 403, cookie = actorCookie) => {
    const before = await snapshot();
    const response = await request(path, method, body, cookie);
    const text = await response.text();
    const after = await snapshot();
    // Check persistence even if a forbidden create incorrectly returns 201.
    assert.deepEqual(after, before, `${method} ${path} (${response.status}): denied request persisted business/audit/notification/chat effects`);
    assert.equal(response.status, status, `${method} ${path}: ${text}`);
    return text;
  };
  const card = (id: string, cookie = actorCookie) => request(`/objects/${id}`, 'GET', undefined, cookie)
    .then((response) => json<ObjectResponseDto>(response, 200));
  const auditAdded = (before: Snapshot, after: Snapshot, id: string, action: string, actorUserId = actor.id) => {
    const logs = after.objectAudits.filter((row) => !before.objectAudits.some((old) => old.id === row.id));
    assert.equal(logs.length, 1);
    assert.equal(logs[0].objectId, id);
    assert.equal(logs[0].actionCode, action);
    assert.equal(logs[0].actorUserId, actorUserId);
    const events = after.audits.filter((row) => !before.audits.some((old) => old.id === row.id) && row.entityType === 'object');
    assert.equal(events.length, 1);
    assert.equal(events[0].entityId, id);
    assert.equal(events[0].action, action);
    assert.equal(events[0].actorUserId, actorUserId);
    assert.deepEqual(events[0].metadata, logs[0].payload);
    return logs[0];
  };
  const noOperationalEffects = (before: Snapshot, after: Snapshot) => {
    for (const key of ['contacts', 'setup', 'planning', 'staffing', 'attendance', 'inventory', 'equipment'] as const) {
      assert.deepEqual(after[key], before[key], key);
    }
  };

  await t.test('access/read selected deny filters before pagination; allow is additive and revoke restores baseline', async () => {
    await reset();
    const a = await fixture('read-A');
    const b = await fixture('read-B');
    const hidden = await fixture('read-hidden', 'active', leader.id, false);
    const check = async (ids: string[]) => {
      const before = await snapshot();
      const page = await json<{ total: number; items: ObjectResponseDto[] }>(
        await request(`/objects?q=${marker}-read-&limit=1`), 200);
      assert.equal(page.total, ids.length);
      assert.equal(page.items.length, Math.min(1, ids.length));
      assert.ok(page.items.every((item) => ids.includes(item.id)));
      const list = await json<ObjectResponseDto[]>(await request(`/objects?search=${marker}-read-`), 200);
      assert.deepEqual(new Set(list.map((item) => item.id)), new Set(ids));
      for (const object of [a, b, hidden]) {
        if (ids.includes(object.id)) assert.equal((await card(object.id)).id, object.id);
        else await denied(`/objects/${object.id}`, 'GET', undefined, 404);
      }
      assert.deepEqual(await snapshot(), before);
    };
    await check([a.id, b.id]);
    await rule('read', 'allow', 'selected', [hidden.id]);
    await check([a.id, b.id, hidden.id]);
    await rule('read', 'deny', 'selected', [a.id]);
    await check([b.id]);
    await revoke('read');
    await check([a.id, b.id]);
    await rule('access', 'deny', 'selected', [a.id]);
    await check([b.id]);
    await rule('read', 'allow', 'all');
    await check([b.id, hidden.id]);
    await rule('access', 'deny', 'all');
    await check([]); // Object collection contract is 200/empty; cards are 404.
    await revoke('access');
    await rule('read', 'deny', 'all');
    await check([]);
    await reset();
    await check([a.id, b.id]);
  });

  const update = async (id: string, cookie = actorCookie) => {
    const before = await snapshot();
    const notes = `${marker}-note-${++sequence}`;
    const changed = await json<ObjectResponseDto>(await request(`/objects/${id}`, 'PATCH', { notes }, cookie), 200);
    const after = await snapshot();
    const old = before.objects.find((row) => row.id === id)!;
    const stored = after.objects.find((row) => row.id === id)!;
    assert.equal(changed.notes, notes);
    assert.deepEqual(stored, { ...old, notes, updatedAt: stored.updatedAt });
    assert.deepEqual(after.objects.filter((row) => row.id !== id), before.objects.filter((row) => row.id !== id));
    assert.deepEqual(after.assignments, before.assignments);
    assert.deepEqual(after.approvals, before.approvals);
    noOperationalEffects(before, after);
    auditAdded(before, after, id, 'object.updated', cookie === leaderCookie ? leader.id : actor.id);
  };

  await t.test('update selected/all, explicit leadership deny and root deny take effect on the old cookies', async () => {
    await reset();
    const a = await fixture('update-A');
    const b = await fixture('update-B');
    const blocked = (id: string, status = 403, cookie = actorCookie) => denied(`/objects/${id}`, 'PATCH', { notes: 'Forbidden core edit' }, status, cookie);
    assert.equal((await card(a.id)).capabilities.canEdit, false);
    await blocked(a.id);
    await rule('access', 'allow', 'selected', [a.id]);
    await blocked(a.id);
    await rule('update', 'allow', 'selected', [a.id]);
    assert.equal((await card(a.id)).capabilities.canEdit, true);
    await update(a.id);
    await denied(`/objects/${a.id}`, 'PATCH', { status: 'frozen' }, 400);
    await blocked(b.id);
    await denied(`/objects/${a.id}/managers`, 'POST', { userId: colleague.id });
    await denied(`/objects/${a.id}/status`, 'PATCH', { status: 'frozen' });
    await rule('update', 'deny', 'selected', [a.id]);
    await blocked(a.id);
    await revoke('update');
    await blocked(a.id);
    await rule('update', 'allow', 'all');
    await update(b.id);
    await rule('access', 'deny', 'selected', [a.id]);
    await blocked(a.id, 404);
    await update(b.id);
    await revoke('access');
    await update(a.id);
    await rule('update', 'deny', 'selected', [a.id], leader.id);
    await blocked(a.id, 403, leaderCookie);
    await update(b.id, leaderCookie);
    await revoke('update', leader.id);
    await update(a.id, leaderCookie);
    await reset();
  });

  await t.test('own and assigned update grants use creator and active assignments independently', async () => {
    await reset();
    const own = await fixture('own-unassigned', 'active', actor.id, false);
    const assigned = await fixture('assigned-not-owned');
    const neither = await fixture('neither', 'active', leader.id, false);
    await rule('read', 'allow', 'all');
    await rule('update', 'allow', 'own');
    await update(own.id);
    await denied(`/objects/${assigned.id}`, 'PATCH', { notes: 'Not creator' });
    await denied(`/objects/${neither.id}`, 'PATCH', { notes: 'Neither scope' });
    await rule('update', 'allow', 'assigned');
    await update(assigned.id);
    await denied(`/objects/${own.id}`, 'PATCH', { notes: 'Owner is not assigned' });
    await prisma.objectAssignment.updateMany({ where: { objectId: assigned.id, userId: actor.id }, data: { isActive: false } });
    await denied(`/objects/${assigned.id}`, 'PATCH', { notes: 'Inactive assignment grants nothing' });
    await revoke('update');
    await denied(`/objects/${own.id}`, 'PATCH', { notes: 'Reverted to role default' });
    await reset();
  });

  for (const operation of ['status', 'freeze', 'archive', 'restore'] as const) {
    await t.test(`${operation} authorizes only a pending request; object state and independent approval remain intact`, async () => {
      await reset();
      // These are initial fixture states, never direct application of a pending decision.
      const initial: Status = operation === 'status' ? 'frozen' : operation === 'restore' ? 'archived' : 'active';
      const next: Status = operation === 'freeze' ? 'frozen' : operation === 'archive' ? 'archived' : 'active';
      const a = await fixture(`${operation}-A`, initial);
      const b = await fixture(`${operation}-B`, initial);
      const blocked = (id: string, status = 403, cookie = actorCookie) => denied(`/objects/${id}/status`, 'PATCH', { status: next }, status, cookie);
      const pending = async (id: string) => {
        const before = await snapshot();
        const result = await json<{ id: string; status: string }>(await request(`/objects/${id}/status`, 'PATCH', { status: next }), 200);
        const after = await snapshot();
        assert.equal(result.status, 'pending');
        assert.deepEqual(after.objects, before.objects, 'Request must not apply the status change');
        assert.deepEqual(after.assignments, before.assignments, 'Pending archive must not remove assignments');
        noOperationalEffects(before, after);
        const added = after.approvals.filter((row) => !before.approvals.some((old) => old.id === row.id));
        assert.equal(added.length, 1);
        assert.equal(added[0].id, result.id);
        assert.equal(added[0].status, 'pending');
        assert.equal(added[0].approvalType, 'object_change_confirmation');
        assert.equal(added[0].sourceEntityType, 'object');
        assert.equal(added[0].sourceEntityId, id);
        assert.equal(added[0].createdByUserId, actor.id);
        assert.equal(added[0].resolvedByUserId, null);
        assert.equal(added[0].resolvedAt, null);
        assert.equal((added[0].payloadSnapshot as { currentStatus: string }).currentStatus, initial);
        assert.equal((added[0].payloadSnapshot as { requestedStatus: string }).requestedStatus, next);
        const audit = auditAdded(before, after, id, 'object.status_change_requested');
        assert.equal((audit.payload as { approvalRequestId: string }).approvalRequestId, result.id);
        const approvalEvents = after.audits.filter((row) => !before.audits.some((old) => old.id === row.id) && row.entityType === 'approval_request');
        assert.equal(approvalEvents.length, 1);
        assert.equal(approvalEvents[0].entityId, result.id);
        assert.equal(approvalEvents[0].action, 'approval.request.created');
        assert.equal(approvalEvents[0].actorUserId, actor.id);
        await denied(`/approvals/${result.id}/approve`, 'POST', {});
        assert.equal((await prisma.object.findUniqueOrThrow({ where: { id } })).status, initial);
      };
      await blocked(a.id);
      await rule('access', 'allow', 'selected', [a.id]);
      await blocked(a.id);
      const otherLeaf = operation === 'freeze' ? 'status' : operation === 'archive' ? 'freeze'
        : operation === 'restore' ? 'archive' : 'freeze';
      await rule(otherLeaf, 'allow', 'all');
      await blocked(a.id);
      await revoke(otherLeaf);
      await rule(operation, 'allow', 'selected', [a.id]);
      await pending(a.id);
      await blocked(b.id);
      // Correct grant reaches duplicate-pending protection without creating another request.
      await blocked(a.id, 409);
      await rule(operation, 'deny', 'selected', [a.id]);
      await blocked(a.id);
      await revoke(operation);
      await blocked(a.id);
      await rule(operation, 'allow', 'all');
      await pending(b.id);
      await rule('access', 'deny', 'selected', [a.id]);
      await blocked(a.id, 404);
      assert.equal((await card(b.id)).status, initial);
      await blocked(b.id, 409);
      await revoke('access');
      await rule(operation, 'deny', 'selected', [a.id], leader.id);
      await blocked(a.id, 403, leaderCookie);
      await revoke(operation, leader.id);
      await blocked(a.id, 409, leaderCookie);
      await reset();
    });
  }

  for (const kind of ['responsibles', 'managers'] as const) {
    await t.test(`${kind}.manage selected/all changes actual assignments and both audits; last responsible stays protected`, async () => {
      await reset();
      const a = await fixture(`${kind}-A`);
      const b = await fixture(`${kind}-B`);
      const suffix = `${kind}.manage`;
      const path = (id: string) => `/objects/${id}/${kind}`;
      const blocked = (id: string, cookie = actorCookie) => denied(path(id), 'POST', { userId: colleague.id }, 403, cookie);
      const assign = async (id: string) => {
        const before = await snapshot();
        const result = await json<ObjectResponseDto>(await request(path(id), 'POST', { userId: colleague.id }), 201);
        const after = await snapshot();
        assert.ok(result[kind].some((user) => user.userId === colleague.id));
        const role = kind === 'responsibles' ? 'responsible' : 'manager';
        const active = after.assignments.filter((row) => row.objectId === id && row.assignmentRoleCode === role && row.isActive);
        assert.ok(active.some((row) => row.userId === colleague.id));
        if (kind === 'responsibles') assert.deepEqual(active.map((row) => row.userId), [colleague.id]);
        assert.deepEqual(after.assignments.filter((row) => row.objectId !== id), before.assignments.filter((row) => row.objectId !== id));
        assert.deepEqual(after.assignments.filter((row) => row.objectId === id && row.assignmentRoleCode !== role), before.assignments.filter((row) => row.objectId === id && row.assignmentRoleCode !== role));
        assert.deepEqual(after.objects, before.objects);
        assert.deepEqual(after.approvals, before.approvals);
        noOperationalEffects(before, after);
        const event = auditAdded(before, after, id, `object.${role}_added`);
        assert.equal((event.payload as { userId: string }).userId, colleague.id);
      };
      await blocked(a.id);
      await denied(`${path(a.id)}/${actor.id}`, 'DELETE');
      await rule('access', 'allow', 'selected', [a.id]);
      await blocked(a.id);
      await rule(suffix, 'allow', 'selected', [a.id]);
      await assign(a.id);
      await blocked(b.id);
      await denied(`/objects/${a.id}`, 'PATCH', { notes: 'Assignment grant does not grant core edit' });
      await rule(suffix, 'deny', 'selected', [a.id]);
      await blocked(a.id);
      await denied(`${path(a.id)}/${colleague.id}`, 'DELETE');
      await revoke(suffix);
      await blocked(a.id);
      await rule(suffix, 'allow', 'all');
      await assign(b.id);
      await rule('access', 'deny', 'selected', [a.id]);
      await blocked(a.id);
      assert.equal((await card(b.id)).id, b.id);
      await revoke('access');
      if (kind === 'managers') {
        const before = await snapshot();
        const result = await json<ObjectResponseDto>(await request(`${path(a.id)}/${colleague.id}`, 'DELETE'), 200);
        const after = await snapshot();
        assert.ok(!result.managers.some((user) => user.userId === colleague.id));
        const old = before.assignments.find((row) => row.objectId === a.id && row.userId === colleague.id && row.assignmentRoleCode === 'manager')!;
        const removed = after.assignments.find((row) => row.id === old.id)!;
        assert.deepEqual(removed, { ...old, isActive: false, updatedAt: removed.updatedAt });
        assert.deepEqual(after.assignments.filter((row) => row.id !== old.id), before.assignments.filter((row) => row.id !== old.id));
        assert.deepEqual(after.objects, before.objects);
        assert.deepEqual(after.approvals, before.approvals);
        noOperationalEffects(before, after);
        auditAdded(before, after, a.id, 'object.manager_removed');
      } else {
        await denied(`${path(a.id)}/${colleague.id}`, 'DELETE');
      }
      await rule(suffix, 'deny', 'selected', [a.id], leader.id);
      await blocked(a.id, leaderCookie);
      await reset();
    });
  }

  const createInput = () => ({ name: `${marker}-created-${++sequence}`, address: 'Isolated HTTP creation', status: 'active' });
  await t.test('create grant persists author, responsible and both audits; root allow grants no creation', async () => {
    await reset();
    await denied('/objects', 'POST', createInput());
    await rule('access', 'allow', 'all');
    await denied('/objects', 'POST', createInput());
    await rule('create', 'allow', 'all');
    const before = await snapshot();
    const input = createInput();
    const created = await json<ObjectResponseDto>(await request('/objects', 'POST', input), 201);
    const after = await snapshot();
    assert.equal(after.objects.length, before.objects.length + 1);
    const stored = after.objects.find((row) => row.id === created.id)!;
    assert.equal(stored.name, input.name);
    assert.equal(stored.createdByUserId, actor.id);
    assert.equal(stored.status, 'active');
    assert.deepEqual(after.objects.filter((row) => row.id !== created.id), before.objects);
    assert.deepEqual(created.responsibles.map((user) => user.userId), [actor.id]);
    const assignments = after.assignments.filter((row) => row.objectId === created.id);
    assert.equal(assignments.length, 1);
    assert.equal(assignments[0].userId, actor.id);
    assert.equal(assignments[0].assignmentRoleCode, 'responsible');
    assert.equal(assignments[0].isActive, true);
    assert.deepEqual(after.assignments.filter((row) => row.objectId !== created.id), before.assignments);
    assert.deepEqual(after.approvals, before.approvals, 'This path does not verify the unimplemented create-approval contract');
    auditAdded(before, after, created.id, 'object.created');
    assert.equal((await card(created.id)).id, created.id);
    await rule('create', 'deny', 'all');
    await denied('/objects', 'POST', createInput());
    await revoke('create');
    await denied('/objects', 'POST', createInput());
    await rule('create', 'allow', 'all');
    await rule('access', 'deny', 'all');
    await denied('/objects', 'POST', createInput());
    await reset();
  });

  await t.test('create allow plus read deny all fails before persistence and cannot leak a created card', async () => {
    await reset();
    try {
      await rule('create', 'allow', 'all');
      await rule('read', 'deny', 'all');
      const input = createInput();
      const responseText = await denied('/objects', 'POST', input);
      assert.equal(responseText.includes(input.name), false, 'Denied create must not disclose the new card');
    } finally {
      await reset();
    }
    // Regression intentionally last: current post-commit mapObject response may
    // expose the defect. Runner owns disposal of this entire isolated schema.
  });
  // No injected audit failure here: several writes call writeObjectAuditLog
  // after business commit. Transactional audit atomicity remains unverified.
});
