import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { ObjectArrivalPhotoResponseDto } from '../src/modules/object-operations/dto/object-arrival-photo-response.dto';
import type { ObjectCommentResponseDto } from '../src/modules/object-operations/dto/object-comment-response.dto';
import type { ObjectFeedItemDto } from '../src/modules/object-operations/dto/object-feed-item.dto';
import type { LinkedOneTimeOrderProjectionDto } from '../src/modules/object-operations/dto/linked-one-time-order-projection.dto';
import type { ObjectResponseDto } from '../src/modules/objects/dto/object-response.dto';
import { moscowDateKey } from '../src/modules/objects/utils/object-season.util';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

const leaves = ['arrival.read', 'arrival.create', 'comments.read', 'comments.create', 'linked_orders.read', 'view_hr'] as const;
type Scope = 'own' | 'assigned' | 'selected' | 'all';

// Six object gaps only. Object comments are domain records, never chat messages.
// HR-profile visibility is a separate read-only branch, not operational access.
test('daily object grants honor live action/scope/parent rules without promoting HR visibility to write authority', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  for (const leaf of leaves) assert.ok(ACCESS_ACTION_CATALOG.some((action) => action.code === `objects.${leaf}`));

  const prisma = new PrismaClient();
  const lifecycle: { close?: () => Promise<void> } = {};
  t.after(async () => {
    try { await lifecycle.close?.(); } finally { await prisma.$disconnect(); }
  });
  const { app, baseUrl } = await createTestApp();
  lifecycle.close = () => app.close();
  const marker = `acl-object-daily-${randomUUID()}`;
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const actor = await prisma.user.create({ data: {
    login: marker, fullName: marker, passwordHash: template.passwordHash, isActive: true,
    roles: { create: { roleId: role.id } },
  } });
  // Exactly one login. Every later rule/assignment change uses this old cookie.
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const request = (path: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, status: number): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, status, text);
    return JSON.parse(text) as T;
  };
  const rule = (leaf: string, effect: 'allow' | 'deny', scope: Scope, selectedIds: string[] = [], module = 'objects') => {
    const actionCode = `${module}.${leaf}`;
    assert.ok(ACCESS_ACTION_CATALOG.find((action) => action.code === actionCode)?.allowedScopes.includes(scope));
    return prisma.userAccessRule.upsert({
      where: { userId_actionCode: { userId: actor.id, actionCode } },
      create: { userId: actor.id, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds },
    });
  };
  const revoke = (leaf: string, module = 'objects') => prisma.userAccessRule.delete({
    where: { userId_actionCode: { userId: actor.id, actionCode: `${module}.${leaf}` } },
  });
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: actor.id } });
  let sequence = 0;
  const objectFixture = async (label: string, assigned: boolean, owner = founder.id) => {
    const object = await prisma.object.create({ data: {
      name: `${marker}-${label}`, address: 'Isolated daily fixture', status: 'active', dailyRate: 1379, monthlySalary: 41370,
      createdByUserId: owner,
      assignments: { create: [
        { userId: founder.id, assignmentRoleCode: 'responsible', isActive: true },
        ...(assigned ? [{ userId: actor.id, assignmentRoleCode: 'manager', isActive: true }] : []),
      ] },
    } });
    // Match the current arrival endpoint's date key. Timezone/date-boundary
    // correctness is outside this ACL test; no clock or runtime is replaced.
    const arrival = await prisma.objectArrivalPhoto.create({ data: {
      objectId: object.id, operationDate: new Date(`${moscowDateKey()}T00:00:00`),
      comment: `Arrival ${label}`, photoType: 'fixture', createdByUserId: founder.id,
    } });
    const comment = await prisma.objectComment.create({ data: {
      objectId: object.id, content: `Comment ${label}`, commentType: 'manual', createdByUserId: founder.id,
    } });
    return { ...object, arrival, comment };
  };
  const a = await objectFixture('assigned-A', true);
  const b = await objectFixture('assigned-B', true);
  const own = await objectFixture('own-unassigned', false, actor.id);
  const hrA = await objectFixture('hr-A', false);
  const hrB = await objectFixture('hr-B', false);
  const employee = await prisma.employee.create({ data: {
    fullName: `${marker}-Employee`, employmentStatus: 'active', baseDailyRate: 2468,
  } });
  await prisma.objectEmployeeAssignment.createMany({ data: [hrA, hrB].map((object) => ({ objectId: object.id, employeeId: employee.id, isActive: true })) });
  const orderFixture = (objectId: string, label: string, visible: boolean) => prisma.oneTimeOrder.create({ data: {
    title: `${marker}-${label}`, executionAddress: 'Isolated linked order', contactName: 'Fixture', status: 'new',
    linkedObjectId: objectId, agreedSum: 12345, createdByUserId: founder.id,
    ...(visible ? { assignments: { create: { userId: actor.id, assignmentRoleCode: 'one_time_manager', isActive: true } } } : {}),
  } });
  const orderA = await orderFixture(a.id, 'visible-order-A', true);
  const hiddenOrderA = await orderFixture(a.id, 'hidden-order-A', false);
  const orderB = await orderFixture(b.id, 'visible-order-B', true);

  const snapshot = async () => ({
    objects: await prisma.object.findMany({ orderBy: { id: 'asc' } }),
    assignments: await prisma.objectAssignment.findMany({ orderBy: { id: 'asc' } }),
    arrivals: await prisma.objectArrivalPhoto.findMany({ orderBy: { id: 'asc' } }),
    comments: await prisma.objectComment.findMany({ orderBy: { id: 'asc' } }),
    reports: await prisma.objectDailyReport.findMany({ orderBy: { id: 'asc' } }),
    contacts: await prisma.objectContact.findMany({ orderBy: { id: 'asc' } }),
    orders: await prisma.oneTimeOrder.findMany({ orderBy: { id: 'asc' } }),
    orderAssignments: await prisma.oneTimeOrderAssignment.findMany({ orderBy: { id: 'asc' } }),
    employees: await prisma.employee.findMany({ orderBy: { id: 'asc' } }),
    staffing: await prisma.objectEmployeeAssignment.findMany({ orderBy: { id: 'asc' } }),
    attendance: await prisma.objectAttendanceFact.findMany({ orderBy: { id: 'asc' } }),
    timesheet: await prisma.timesheetDayEntry.findMany({ orderBy: { id: 'asc' } }),
    files: await prisma.fileAttachment.findMany({ orderBy: { id: 'asc' } }),
    audit: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    objectAudit: await prisma.objectAuditLog.findMany({ orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ orderBy: { id: 'asc' } }),
    inventory: await prisma.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
    equipment: await prisma.equipmentMovement.findMany({ orderBy: { id: 'asc' } }),
    rooms: await prisma.chatRoom.findMany({ orderBy: { id: 'asc' } }),
    participants: await prisma.chatRoomParticipant.findMany({ orderBy: { id: 'asc' } }),
    messages: await prisma.chatMessage.findMany({ orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    outbox: await prisma.notificationOutbox.findMany({ orderBy: { id: 'asc' }, select: {
      id: true, notificationId: true, recipientUserId: true, createdAt: true,
    } }),
  });
  type Snapshot = Awaited<ReturnType<typeof snapshot>>;
  const onlyChanges = (before: Snapshot, after: Snapshot, key: 'arrivals' | 'comments') => {
    for (const field of Object.keys(before) as Array<keyof Snapshot>) {
      if (field !== key) assert.deepEqual(after[field], before[field], field);
    }
  };
  const denied = async (path: string, method = 'GET', body?: unknown, expected = 403) => {
    const before = await snapshot();
    const response = await request(path, method, body);
    const text = await response.text();
    assert.deepEqual(await snapshot(), before, `${method} ${path}: denied request must have zero business/audit/chat effects`);
    assert.equal(response.status, expected, text);
  };
  const feed = (id: string) => request(`/objects/${id}/feed?limit=100`).then((response) => json<ObjectFeedItemDto[]>(response, 200));

  for (const leaf of ['arrival.read', 'comments.read'] as const) {
    await t.test(`${leaf}: direct data and feed filtering honor selected/all deny, additive allow, revoke and read parent`, async () => {
      await reset();
      const path = (id: string) => `/objects/${id}/${leaf === 'arrival.read' ? 'arrival-photo/today' : 'comments'}`;
      const read = async (target: typeof a) => {
        const before = await snapshot();
        if (leaf === 'arrival.read') {
          const result = await json<ObjectArrivalPhotoResponseDto>(await request(path(target.id)), 200);
          assert.equal(result.id, target.arrival.id);
          assert.equal(result.comment, target.arrival.comment);
          assert.equal(result.createdBy.id, founder.id);
        } else {
          const result = await json<ObjectCommentResponseDto[]>(await request(path(target.id)), 200);
          assert.deepEqual(result.map((row) => row.id), [target.comment.id]);
          assert.equal(result[0].content, target.comment.content);
          assert.equal(result[0].createdBy.id, founder.id);
        }
        const entries = await feed(target.id);
        assert.ok(entries.some((row) => row.id === target.arrival.id && row.type === 'arrival_photo'));
        assert.ok(entries.some((row) => row.id === target.comment.id && row.type === 'comment'));
        assert.deepEqual(await snapshot(), before);
      };
      const blocked = async (target: typeof a) => {
        await denied(path(target.id));
        const before = await snapshot();
        const entries = await feed(target.id);
        const hiddenId = leaf === 'arrival.read' ? target.arrival.id : target.comment.id;
        const retainedId = leaf === 'arrival.read' ? target.comment.id : target.arrival.id;
        assert.ok(!entries.some((row) => row.id === hiddenId));
        assert.ok(entries.some((row) => row.id === retainedId));
        assert.deepEqual(await snapshot(), before);
      };
      await read(a);
      await read(b);
      await rule(leaf, 'allow', 'selected', [a.id]);
      await read(a);
      await read(b);
      await rule(leaf, 'deny', 'selected', [a.id]);
      await blocked(a);
      await read(b);
      await revoke(leaf);
      await read(a);
      await rule(leaf, 'deny', 'all');
      await blocked(a);
      await blocked(b);
      await rule(leaf, 'allow', 'all');
      for (const parent of ['read', 'access'] as const) {
        await rule(parent, 'deny', 'selected', [a.id]);
        await denied(path(a.id));
        await denied(`/objects/${a.id}/feed`);
        await read(b);
        await revoke(parent);
      }
      await reset();
    });
  }

  const write = async (leaf: 'arrival.create' | 'comments.create', id: string) => {
    const before = await snapshot();
    if (leaf === 'arrival.create') {
      const input = { photoType: 'arrival', comment: `HTTP arrival ${++sequence}` };
      const result = await json<ObjectArrivalPhotoResponseDto>(await request(`/objects/${id}/arrival-photo`, 'POST', input), 201);
      const after = await snapshot();
      onlyChanges(before, after, 'arrivals');
      const old = before.arrivals.find((row) => row.objectId === id);
      const stored = after.arrivals.find((row) => row.id === result.id)!;
      if (old) {
        assert.equal(result.id, old.id, 'Same-day update cannot create a duplicate arrival');
        assert.deepEqual(stored, { ...old, photoType: input.photoType, photoUrl: null,
          comment: input.comment, createdByUserId: actor.id, updatedAt: stored.updatedAt });
      } else {
        assert.equal(stored.objectId, id);
        assert.equal(stored.photoType, input.photoType);
        assert.equal(stored.photoUrl, null);
        assert.equal(stored.comment, input.comment);
        assert.equal(stored.createdByUserId, actor.id);
      }
      assert.equal(result.createdBy.id, actor.id);
      assert.equal(result.comment, input.comment);
      assert.equal(after.arrivals.length, before.arrivals.length + (old ? 0 : 1));
      assert.deepEqual(after.arrivals.filter((row) => row.id !== result.id), before.arrivals.filter((row) => row.id !== result.id));
      const persisted = await json<ObjectArrivalPhotoResponseDto>(await request(`/objects/${id}/arrival-photo/today`), 200);
      assert.equal(persisted.id, result.id);
      assert.equal(persisted.comment, input.comment);
      assert.deepEqual(await snapshot(), after);
    } else {
      const input = { content: `HTTP comment ${++sequence}`, commentType: 'manual' };
      const result = await json<ObjectCommentResponseDto>(await request(`/objects/${id}/comments`, 'POST', input), 201);
      const after = await snapshot();
      onlyChanges(before, after, 'comments');
      const stored = after.comments.find((row) => row.id === result.id)!;
      assert.equal(stored.objectId, id);
      assert.equal(stored.createdByUserId, actor.id);
      assert.equal(stored.content, input.content);
      assert.equal(stored.commentType, 'manual');
      assert.equal(result.createdBy.id, actor.id);
      assert.equal(after.comments.length, before.comments.length + 1);
      assert.deepEqual(after.comments.filter((row) => row.id !== result.id), before.comments);
      const persisted = await json<ObjectCommentResponseDto[]>(await request(`/objects/${id}/comments`), 200);
      assert.ok(persisted.some((row) => row.id === result.id && row.content === input.content));
      assert.ok((await feed(id)).some((row) => row.id === result.id && row.type === 'comment'));
      assert.deepEqual(after.messages, before.messages, 'An object comment must not create a chat message');
      assert.deepEqual(await snapshot(), after, 'Reading the written comment creates no effects');
    }
  };
  for (const leaf of ['arrival.create', 'comments.create'] as const) {
    await t.test(`${leaf}: actual write, own/assigned/selected boundaries, revoke and parent deny`, async () => {
      await reset();
      const path = (id: string) => `/objects/${id}/${leaf === 'arrival.create' ? 'arrival-photo' : 'comments'}`;
      const input = leaf === 'arrival.create' ? { comment: 'Denied arrival' } : { content: 'Denied comment' };
      if (leaf === 'arrival.create') {
        const fresh = await prisma.object.create({ data: {
          name: `${marker}-fresh-arrival`, address: 'New arrival fixture', status: 'active', createdByUserId: actor.id,
          assignments: { create: { userId: founder.id, assignmentRoleCode: 'responsible', isActive: true } },
        } });
        await write(leaf, fresh.id);
        await write(leaf, fresh.id);
      }
      await rule(leaf, 'deny', 'selected', [a.id]);
      await denied(path(a.id), 'POST', input);
      await write(leaf, b.id);
      await revoke(leaf);
      await write(leaf, a.id);
      await rule(leaf, 'allow', 'selected', [a.id]);
      await write(leaf, a.id);
      await denied(path(hrA.id), 'POST', input);
      await rule(leaf, 'deny', 'all');
      await denied(path(a.id), 'POST', input);
      await denied(path(b.id), 'POST', input);
      await rule(leaf, 'allow', 'all');
      await write(leaf, b.id);
      for (const parent of ['read', 'access'] as const) {
        await rule(parent, 'deny', 'selected', [a.id]);
        await denied(path(a.id), 'POST', input);
        await write(leaf, b.id);
        await revoke(parent);
      }
      await rule(leaf, 'deny', 'own');
      await denied(path(own.id), 'POST', input);
      await write(leaf, a.id);
      await rule(leaf, 'deny', 'assigned');
      await denied(path(a.id), 'POST', input);
      await write(leaf, own.id);
      await revoke(leaf);
      await write(leaf, a.id);
      await reset();
    });
  }

  await t.test('linked_orders.read checks object and order scopes independently, retaining control B and masking finance', async () => {
    await reset();
    const path = (id: string) => `/objects/${id}/linked-one-time-orders`;
    const read = async (id: string, expected: string[]) => {
      const before = await snapshot();
      const result = await json<LinkedOneTimeOrderProjectionDto[]>(await request(path(id)), 200);
      assert.deepEqual(result.map((row) => row.id).sort(), [...expected].sort());
      assert.ok(result.every((row) => row.canOpenOrderCard));
      assert.ok(!result.some((row) => row.id === hiddenOrderA.id));
      assert.deepEqual(await snapshot(), before);
      return result;
    };
    assert.equal((await read(a.id, [orderA.id]))[0].title, orderA.title);
    assert.equal((await read(b.id, [orderB.id]))[0].agreedSum, 12345);
    await rule('linked_orders.read', 'allow', 'selected', [a.id]);
    await read(a.id, [orderA.id]);
    await read(b.id, [orderB.id]);
    await rule('linked_orders.read', 'deny', 'selected', [a.id]);
    await denied(path(a.id));
    await read(b.id, [orderB.id]);
    await revoke('linked_orders.read');
    await read(a.id, [orderA.id]);
    await rule('linked_orders.read', 'deny', 'all');
    await denied(path(a.id));
    await denied(path(b.id));
    await rule('linked_orders.read', 'allow', 'all');
    for (const parent of ['read', 'access'] as const) {
      await rule(parent, 'deny', 'selected', [a.id]);
      await denied(path(a.id));
      await read(b.id, [orderB.id]);
      await revoke(parent);
    }
    await rule('read', 'deny', 'selected', [orderA.id], 'one_time_orders');
    await read(a.id, []);
    await read(b.id, [orderB.id]);
    await revoke('read', 'one_time_orders');
    await rule('finance.read', 'deny', 'selected', [orderA.id], 'one_time_orders');
    assert.equal((await read(a.id, [orderA.id]))[0].agreedSum, null);
    assert.equal((await read(b.id, [orderB.id]))[0].agreedSum, 12345);
    await revoke('finance.read', 'one_time_orders');
    assert.equal((await read(a.id, [orderA.id]))[0].agreedSum, 12345);
    await reset();
  });

  await t.test('view_hr selected/all enables only a basic read branch; read/access deny and revoke remove it', async () => {
    await reset();
    const before = await snapshot();
    const list = async (expected: string[]) => {
      const result = await json<{ total: number; items: ObjectResponseDto[] }>(await request(`/objects?q=${marker}-hr-&limit=1`), 200);
      assert.equal(result.total, expected.length);
      assert.ok(result.items.every((row) => expected.includes(row.id)));
    };
    const read = async (id: string) => {
      const result = await json<ObjectResponseDto>(await request(`/objects/${id}`), 200);
      assert.equal(result.capabilities.canViewBasicProfile, true);
      assert.equal(result.capabilities.canViewOperationalSections, false);
      assert.equal(result.capabilities.canEdit, false);
      assert.equal(result.capabilities.canCreateTask, false);
      assert.equal(result.capabilities.canManageManagers, false);
      assert.equal(result.capabilities.canManageResponsibles, false);
      assert.equal(result.capabilities.canOperateAttendance, false);
      assert.equal(result.capabilities.canViewCompensationRates, false);
      assert.equal(result.dailyRate, null);
      assert.equal(result.monthlySalary, null);
      assert.ok(result.employees.some((row) => row.id === employee.id && row.baseDailyRate === null));
      return result;
    };
    await list([]);
    await denied(`/objects/${hrA.id}`, 'GET', undefined, 404);
    await rule('view_hr', 'allow', 'selected', [hrA.id]);
    await list([hrA.id]);
    await read(hrA.id);
    await denied(`/objects/${hrB.id}`, 'GET', undefined, 404);
    // A profile grant must not turn object/read visibility into operational scope.
    for (const target of [hrA]) {
      await denied(`/objects/${target.id}/arrival-photo/today`);
      await denied(`/objects/${target.id}/comments`);
      await denied(`/objects/${target.id}/daily-report/today`);
      await denied(`/objects/${target.id}/inventory`);
      await denied(`/objects/${target.id}/equipment`);
      await denied(`/objects/${target.id}/linked-one-time-orders`);
      await denied(`/objects/${target.id}/arrival-photo`, 'POST', { comment: 'HR cannot operate' });
      await denied(`/objects/${target.id}/comments`, 'POST', { content: 'HR cannot write' });
      await denied(`/objects/${target.id}/daily-report/today`, 'PUT', { content: 'HR cannot save draft', expectedRevision: 0 });
      await denied(`/objects/${target.id}/attendance`, 'POST', { operationDate: moscowDateKey(), employeeIds: [] });
      await denied(`/objects/${target.id}`, 'PATCH', { notes: 'HR cannot edit core' });
    }
    await rule('view_hr', 'deny', 'selected', [hrA.id]);
    await list([]);
    await denied(`/objects/${hrA.id}`, 'GET', undefined, 404);
    await revoke('view_hr');
    await denied(`/objects/${hrA.id}`, 'GET', undefined, 404);
    await rule('view_hr', 'allow', 'all');
    await list([hrA.id, hrB.id]);
    await read(hrB.id);
    for (const parent of ['read', 'access'] as const) {
      await rule(parent, 'deny', 'selected', [hrA.id]);
      await denied(`/objects/${hrA.id}`, 'GET', undefined, 404);
      await list([hrB.id]);
      await read(hrB.id);
      await revoke(parent);
    }
    await rule('view_hr', 'deny', 'all');
    await list([]);
    await denied(`/objects/${hrA.id}`, 'GET', undefined, 404);
    assert.equal((await json<ObjectResponseDto>(await request(`/objects/${a.id}`), 200)).capabilities.canViewOperationalSections, true,
      'Denying the HR branch does not remove an independent active manager assignment');
    await reset();
    assert.deepEqual(await snapshot(), before, 'HR profile reads and rejected operations must not alter staffing, money, audit or chats');
  });
  // No storage/media bytes, timezone correctness, UI, delivery or production
  // checks are claimed. No role/permission edits or Employee-to-User conversion.
  // The isolated serial runner owns schema disposal; no shared cleanup occurs.
});
