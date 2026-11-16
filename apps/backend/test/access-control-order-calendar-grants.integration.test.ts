import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { OneTimeOrderCalendarResponseDto } from '../src/modules/one-time-orders/dto/one-time-order-calendar-response.dto';
import type { OneTimeManagerAvailabilityResponseDto } from '../src/modules/one-time-orders/dto/one-time-manager-availability-response.dto';
import { ACCESS_ACTION_CATALOG, getAccessAction } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

const prefix = 'one_time_order_calendar';
type Availability = OneTimeManagerAvailabilityResponseDto;
type Calendar = OneTimeOrderCalendarResponseDto;

test('order-calendar grants preserve roster/source privacy and manager-scoped availability transitions', async (t) => {
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
  const [actor, a, b, founder] = await Promise.all(['drozdovskiy', 'berendyakov', 'gomonova', 'founder'].map((login) =>
    prisma.user.findUniqueOrThrow({ where: { login }, include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      permissions: { include: { permission: true } },
    } })));
  assert.deepEqual(actor.roles.map(({ role }) => role.code), ['operation_manager']);
  const permissionCodes = [...actor.permissions.map(({ permission }) => permission.code),
    ...actor.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code))];
  assert.equal(permissionCodes.includes('one_time_order.calendar.manage'), false);
  assert.equal(permissionCodes.includes('one_time_order.calendar.approve_availability'), false);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: { in: [actor.id, founder.id] } } }), 0);
  for (const user of [actor, a, b]) assert.equal((await prisma.oneTimeOrderCalendarManager.findUniqueOrThrow({ where: { userId: user.id } })).isVisible, true);
  const [cookie, aCookie, bCookie, founderCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'drozdovskiy123' }),
    loginAndGetCookieHeader({ baseUrl, login: a.login, password: 'berendyakov123' }),
    loginAndGetCookieHeader({ baseUrl, login: b.login, password: 'gomonova123' }),
    loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' }),
  ]);
  const marker = `acl-order-calendar-${randomUUID()}`;
  const month = '2047-04';
  const orderFixtures: Array<{ id: string; title: string }> = [];
  for (const [label, managerId, state, day, visible] of [
    ['A', a.id, 'planned', '10', true], ['B', b.id, 'completed', '11', true],
    ['cancelled', a.id, 'cancelled', '12', true], ['secret', a.id, 'planned', '13', false],
  ] as const) orderFixtures.push(await prisma.oneTimeOrder.create({ data: {
    title: `${marker}-${label}`, executionAddress: `${marker}-address-${label}`, contactName: `${marker}-contact-${label}`,
    status: state, executionStartDate: new Date(`${month}-${day}T00:00:00Z`), executionEndDate: new Date(`${month}-${day}T00:00:00Z`),
    createdByUserId: founder.id, assignments: { create: [managerId, ...(visible ? [actor.id] : [])].map((userId) => ({
      userId, assignmentRoleCode: 'one_time_manager', isActive: true,
    })) },
  } }));
  const [orderA, orderB, cancelledOrder, hiddenOrder] = orderFixtures;
  const snapshot = async () => ({
    availability: await prisma.oneTimeManagerAvailability.findMany({ orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ orderBy: { id: 'asc' } }),
    audit: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    roster: await prisma.oneTimeOrderCalendarManager.findMany({ orderBy: { id: 'asc' } }),
    orders: await prisma.oneTimeOrder.findMany({ where: { id: { in: orderFixtures.map(({ id }) => id) } }, orderBy: { id: 'asc' } }),
    assignments: await prisma.oneTimeOrderAssignment.findMany({ where: { oneTimeOrderId: { in: orderFixtures.map(({ id }) => id) } }, orderBy: { id: 'asc' } }),
  });
  const request = (path: string, method = 'GET', body?: unknown, auth = cookie): Promise<Response> => fetch(`${baseUrl}/api/v1/one-time-orders/calendar${path}`, {
    method, headers: { Cookie: auth, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const ok = async <T>(path: string, method = 'GET', body?: unknown, expected = 200, auth = cookie): Promise<T> => {
    const response = await request(path, method, body, auth);
    assert.equal(response.status, expected, `${method} ${path}: ${await response.clone().text()}`);
    return response.json() as Promise<T>;
  };
  const rejected = async (path: string, method = 'GET', body?: unknown, expected = 403, auth = cookie) => {
    const before = await snapshot();
    const response = await request(path, method, body, auth);
    assert.equal(response.status, expected, `${method} ${path}: ${await response.clone().text()}`);
    assert.deepEqual(await snapshot(), before, 'Rejected request changes no availability, approval, audit, roster or order');
  };
  const withRule = async (code: string, effect: 'allow' | 'deny', ids: string[] | undefined, run: () => Promise<void>, userId = actor.id) => {
    const previous = await prisma.userAccessRule.findUnique({ where: { userId_actionCode: { userId, actionCode: code } } });
    const data = { effect, scope: ids ? 'selected' : 'all', selectedIds: ids ?? [] };
    const saved = previous ? await prisma.userAccessRule.update({ where: { id: previous.id }, data })
      : await prisma.userAccessRule.create({ data: { userId, actionCode: code, ...data } });
    try { await run(); } finally {
      if (previous) await prisma.userAccessRule.update({ where: { id: saved.id }, data: {
        effect: previous.effect, scope: previous.scope, selectedIds: previous.selectedIds,
      } });
      else await prisma.userAccessRule.delete({ where: { id: saved.id } });
    }
  };
  const query = (managerId: string, extra = '') => `?month=${month}&managerUserId=${managerId}${extra}`;
  const calendar = (managerId: string, extra = '') => ok<Calendar>(query(managerId, extra));
  const exported = async (managerId: string, extra = '') => {
    const before = await snapshot();
    const response = await request(`/export.xlsx${query(managerId, extra)}`);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.ok(response.headers.get('content-disposition')?.includes(`one-time-orders-calendar-${month}.xlsx`));
    const buffer = Buffer.from(await response.arrayBuffer());
    assert.equal(buffer.subarray(0, 2).toString(), 'PK');
    // Existing simple-XLSX writer stores uncompressed XML; no office process.
    const raw = buffer.toString('utf8');
    assert.deepEqual(await snapshot(), before, 'Export is read-only');
    return raw;
  };
  const payload = (day: string, userId?: string) => ({
    entryType: 'day_off', startDate: `${month}-${day}`, endDate: `${month}-${day}`, comment: `${marker}-private-${day}`,
    ...(userId ? { userId } : {}),
  });
  const effects = async (before: Awaited<ReturnType<typeof snapshot>>, id: string, actions: string[], actorId = actor.id, approvalId?: string | null) => {
    const after = await snapshot();
    const added = after.audit.filter((row) => !before.audit.some(({ id }) => id === row.id));
    assert.deepEqual(added.map(({ action }) => action).sort(), [...actions].sort());
    for (const row of added) {
      assert.equal(row.actorUserId, actorId);
      const approval = row.action.startsWith('approval.request.');
      assert.equal(row.entityType, approval ? 'approval_request' : 'one_time_manager_availability');
      assert.equal(row.entityId, approval ? approvalId : id);
    }
    assert.deepEqual({ ...after,
      availability: after.availability.filter((row) => row.id !== id),
      approvals: after.approvals.filter((row) => row.id !== approvalId),
      audit: after.audit.filter((row) => !added.some(({ id }) => id === row.id)),
    }, { ...before,
      availability: before.availability.filter((row) => row.id !== id),
      approvals: before.approvals.filter((row) => row.id !== approvalId),
    }, 'Only the targeted availability/approval and exact audited actions may change');
    return after;
  };

  await t.test('exact catalogue and unsupported manage cannot manufacture runtime authority', async () => {
    assert.deepEqual(ACCESS_ACTION_CATALOG.filter(({ module }) => module === prefix).map(({ code }) => code).sort(), [
      `${prefix}.access`, `${prefix}.read`, `${prefix}.export`, `${prefix}.manage`,
      `${prefix}.availability.own`, `${prefix}.availability.manage`, `${prefix}.availability.approve`,
    ].sort());
    assert.equal(getAccessAction(`${prefix}.manage`)!.manageable, false);
    assert.equal(getAccessAction(`${prefix}.manage`)!.constraint, 'unsupported_standalone_operation');
    assert.equal(getAccessAction(`${prefix}.availability.approve`)!.manageable, false);
    assert.equal(getAccessAction(`${prefix}.availability.approve`)!.constraint, 'policy_decision_required');
    await withRule(`${prefix}.manage`, 'allow', undefined, () => rejected('/availability/direct', 'POST', payload('01', a.id)));
  });

  await t.test('read/export use real manager IDs, current-cookie selected denies/default and source-safe list filters', async () => {
    const before = await snapshot();
    const baseline = await calendar(a.id);
    assert.deepEqual(baseline.managers.map(({ user }) => user.id), [a.id]);
    assert.ok(JSON.stringify(baseline).includes(orderA.title));
    assert.equal(JSON.stringify(baseline).includes(cancelledOrder.title), false);
    assert.equal(JSON.stringify(baseline).includes(hiddenOrder.title), false);
    assert.deepEqual(baseline.managers[0].days.find(({ date }) => date === `${month}-13`)!.orders, [
      { type: 'existing_order', detailsRestricted: true, relatedOrder: null },
    ]);
    assert.ok(JSON.stringify(await calendar(a.id, '&includeCancelled=true')).includes(cancelledOrder.title));
    assert.equal(JSON.stringify(await calendar(a.id, '&status=completed')).includes(orderA.title), false);
    assert.ok(JSON.stringify(await calendar(b.id, '&status=completed')).includes(orderB.title));
    assert.deepEqual(await snapshot(), before);
    for (const gate of [`${prefix}.read`, `${prefix}.access`]) {
      await withRule(gate, 'allow', [a.id], async () => {
        await withRule(gate, 'deny', [a.id], async () => {
          await rejected(query(a.id));
          await rejected(`/export.xlsx${query(a.id)}`);
          const roster = await ok<Array<{ id: string }>>('/managers');
          assert.equal(roster.some(({ id }) => id === a.id), false);
          assert.ok(roster.some(({ id }) => id === b.id));
          assert.ok(JSON.stringify(await calendar(b.id)).includes(orderB.title));
        });
      });
      assert.ok(JSON.stringify(await calendar(a.id)).includes(orderA.title));
    }
    await withRule(`${prefix}.export`, 'deny', [a.id], async () => {
      await rejected(`/export.xlsx${query(a.id)}`);
      assert.ok(JSON.stringify(await calendar(a.id)).includes(orderA.title), 'Export deny does not deny calendar read');
      assert.ok((await exported(b.id)).includes(orderB.title));
    });
    const raw = await exported(a.id, '&includeCancelled=true');
    assert.ok(raw.includes(orderA.title));
    assert.ok(raw.includes(cancelledOrder.title));
    assert.equal(raw.includes(orderB.title), false);
    assert.equal(raw.includes(hiddenOrder.title), false);
    for (const gate of ['one_time_orders.read', 'one_time_orders.access']) await withRule(gate, 'deny', [orderA.id], async () => {
      assert.equal(JSON.stringify(await calendar(a.id)).includes(orderA.title), false);
      assert.equal((await exported(a.id)).includes(orderA.title), false);
      assert.ok(JSON.stringify(await calendar(b.id)).includes(orderB.title));
    });
    await withRule('one_time_orders.read', 'allow', [hiddenOrder.id], async () => {
      assert.ok(JSON.stringify(await calendar(a.id)).includes(hiddenOrder.title));
    });
    assert.equal(JSON.stringify(await calendar(a.id)).includes(hiddenOrder.title), false, 'Source allow revokes without a new cookie');
    await rejected('?month=2047-13', 'GET', undefined, 400);
  });

  await t.test('own availability requests/cancel are self-bound, audited and denied by leaf/section without effects', async () => {
    for (const gate of [`${prefix}.availability.own`, `${prefix}.access`]) await withRule(gate, 'deny', [actor.id], async () => {
      await rejected('/availability-requests', 'POST', payload('02'));
      await rejected('/availability-requests/me');
    });
    const before = await snapshot();
    const pending = await ok<Availability>('/availability-requests', 'POST', payload('02'), 201);
    assert.equal(pending.userId, actor.id);
    assert.equal(pending.status, 'pending');
    assert.ok(pending.approvalRequestId);
    const after = await effects(before, pending.id, ['one_time_manager_availability.requested', 'approval.request.created'], actor.id, pending.approvalRequestId);
    assert.equal(after.approvals.find(({ id }) => id === pending.approvalRequestId)!.sourceEntityId, pending.id);
    assert.equal(after.availability.find(({ id }) => id === pending.id)!.requestedByUserId, actor.id);
    await rejected('/availability-requests', 'POST', payload('02'), 409);
    await withRule(`${prefix}.availability.own`, 'deny', [actor.id], () => rejected(`/availability/${pending.id}/cancel`, 'POST'));
    const mine = await ok<Availability[]>('/availability-requests/me');
    assert.ok(mine.some(({ id }) => id === pending.id));
    assert.ok(mine.every(({ userId }) => userId === actor.id));
    const beforeCancel = await snapshot();
    const cancelled = await ok<Availability>(`/availability/${pending.id}/cancel`, 'POST', undefined, 201);
    assert.equal(cancelled.status, 'cancelled');
    const cancelledState = await effects(beforeCancel, pending.id, ['one_time_manager_availability.cancelled', 'approval.request.cancelled'], actor.id, pending.approvalRequestId);
    assert.equal(cancelledState.approvals.find(({ id }) => id === pending.approvalRequestId)!.status, 'cancelled');
    assert.equal(cancelledState.availability.find(({ id }) => id === pending.id)!.cancelledByUserId, actor.id);
    await rejected(`/availability/${pending.id}/cancel`, 'POST', undefined, 409);
  });

  await t.test('selected manage grants direct create/update only for A and retain overlap/state constraints on revoke/default', async () => {
    await rejected('/availability/direct', 'POST', payload('03', a.id));
    const managed: { created?: Availability } = {};
    await withRule(`${prefix}.availability.manage`, 'allow', [a.id], async () => {
      await rejected('/availability/direct', 'POST', payload('03', b.id));
      for (const gate of [`${prefix}.availability.manage`, `${prefix}.access`]) await withRule(gate, 'deny', [a.id], () => rejected('/availability/direct', 'POST', payload('03', a.id)));
      const before = await snapshot();
      const created = await ok<Availability>('/availability/direct', 'POST', payload('03', a.id), 201);
      managed.created = created;
      assert.equal(created.status, 'approved');
      assert.equal(created.userId, a.id);
      assert.equal(created.approvalRequestId, null);
      const after = await effects(before, created.id, ['one_time_manager_availability.direct_created']);
      assert.equal(after.availability.find(({ id }) => id === created.id)!.resolvedByUserId, actor.id);
      assert.equal((await calendar(a.id)).managers[0].days.find(({ date }) => date === `${month}-03`)!.availability!.comment, null,
        'A personal management grant must not leak another manager private comments through calendar read');
      await rejected('/availability/direct', 'POST', payload('03', a.id), 409);
      const other = await ok<Availability>('/availability/direct', 'POST', payload('04', b.id), 201, founderCookie);
      await rejected(`/availability/${other.id}`, 'PATCH', { comment: 'Cannot edit control B' });
      for (const gate of [`${prefix}.availability.manage`, `${prefix}.access`]) await withRule(gate, 'deny', [a.id], () => rejected(`/availability/${created.id}`, 'PATCH', { comment: 'Denied update' }));
      const overlap = await ok<Availability>('/availability/direct', 'POST', payload('05', a.id), 201);
      await rejected(`/availability/${created.id}`, 'PATCH', { startDate: overlap.startDate, endDate: overlap.endDate }, 409);
      await rejected(`/availability/${created.id}`, 'PATCH', { startDate: `${month}-20`, endDate: `${month}-01` }, 400);
      const beforeUpdate = await snapshot();
      const updated = await ok<Availability>(`/availability/${created.id}`, 'PATCH', { entryType: 'vacation', comment: `${marker}-updated` });
      assert.equal(updated.entryType, 'vacation');
      assert.equal(updated.requestComment, `${marker}-updated`);
      assert.equal(updated.userId, a.id);
      await effects(beforeUpdate, created.id, ['one_time_manager_availability.updated']);
      const pending = await ok<Availability>('/availability-requests', 'POST', payload('06'), 201, aCookie);
      await rejected(`/availability/${pending.id}`, 'PATCH', { comment: 'Pending cannot be edited' }, 409);
      assert.equal(JSON.stringify(await calendar(a.id)).includes(pending.id), false, 'A manage grant alone does not reveal another manager pending request');
    });
    assert.ok(managed.created);
    await rejected(`/availability/${managed.created.id}`, 'PATCH', { comment: 'Revoked grant' });
    await rejected('/availability/direct', 'POST', payload('07', a.id));
  });

  await t.test('policy-locked approval cannot be granted to an ordinary manager; selected founder denies keep B independent', async () => {
    const pendingA = await ok<Availability>('/availability-requests', 'POST', payload('08'), 201, aCookie);
    const pendingControls = [
      await ok<Availability>('/availability-requests', 'POST', payload('09'), 201, bCookie),
      await ok<Availability>('/availability-requests', 'POST', payload('16'), 201, bCookie),
    ];
    await withRule(`${prefix}.availability.approve`, 'allow', [a.id], async () => {
      await rejected(`/availability/${pendingA.id}/approve`, 'POST', {});
      await rejected(`/availability/${pendingA.id}/reject`, 'POST', { comment: 'No personal approval authority' });
    });
    for (const [index, gate] of [`${prefix}.availability.approve`, `${prefix}.access`].entries()) await withRule(gate, 'deny', [a.id], async () => {
      await rejected(`/availability/${pendingA.id}/approve`, 'POST', {}, 403, founderCookie);
      await rejected(`/availability/${pendingA.id}/reject`, 'POST', { comment: 'Selected deny' }, 403, founderCookie);
      const control = pendingControls[index];
      const beforeB = await snapshot();
      const rejectedB = await ok<Availability>(`/availability/${control.id}/reject`, 'POST', { comment: 'Control B decision' }, 201, founderCookie);
      assert.equal(rejectedB.status, 'rejected');
      await effects(beforeB, control.id, ['one_time_manager_availability.rejected', 'approval.request.rejected'], founder.id, control.approvalRequestId);
    }, founder.id);
    const beforeA = await snapshot();
    const approvedA = await ok<Availability>(`/availability/${pendingA.id}/approve`, 'POST', { comment: 'Authorized default policy' }, 201, founderCookie);
    assert.equal(approvedA.status, 'approved');
    const afterA = await effects(beforeA, pendingA.id, ['one_time_manager_availability.approved', 'approval.request.approved'], founder.id, pendingA.approvalRequestId);
    assert.equal(afterA.approvals.find(({ id }) => id === pendingA.approvalRequestId)!.status, 'approved');
    assert.equal(afterA.availability.find(({ id }) => id === pendingA.id)!.resolvedByUserId, founder.id);
    await rejected(`/availability/${pendingA.id}/approve`, 'POST', {}, 409, founderCookie);
  });

  await t.test('selected manage must also authorize cancellation of approved A without becoming a global grant', async () => {
    // Regression target: cancelAvailability currently calls canManage without
    // the target user ID after its correctly scoped leaf check.
    await withRule(`${prefix}.availability.manage`, 'allow', [a.id], async () => {
      const created = await ok<Availability>('/availability/direct', 'POST', payload('14', a.id), 201);
      const before = await snapshot();
      const cancelled = await ok<Availability>(`/availability/${created.id}/cancel`, 'POST', undefined, 201);
      assert.equal(cancelled.status, 'cancelled');
      await effects(before, created.id, ['one_time_manager_availability.cancelled']);
    });
  });
  assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, include: {
    roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    permissions: { include: { permission: true } },
  } }), actor, 'No changes to roles or legacy permissions');
});
