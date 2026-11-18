import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { notificationAccessWhere } from '../src/common/access/notification-access';
import type { NotificationListResponseDto, NotificationResponseDto } from '../src/modules/notifications/dto/notification-response.dto';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Scope = 'own' | 'assigned' | 'selected' | 'all';
type SourceKey = 'objectA' | 'objectB' | 'taskA' | 'taskB' | 'candidateA' | 'candidateB' | 'hiddenObject' | 'hiddenTask' | 'missingObject';

test('notification own/all grants preserve recipient and current source visibility through HTTP and stored effects', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  const actions = ACCESS_ACTION_CATALOG.filter((action) => action.module === 'notifications');
  assert.deepEqual(actions.map((action) => action.code).sort(), ['access', 'read', 'mark_read', 'dismiss', 'realtime'].map((suffix) => `notifications.${suffix}`).sort());
  for (const action of actions) {
    assert.deepEqual(action.allowedScopes, ['own', 'all']);
    assert.ok(action.invariants?.includes('current_recipient'));
    assert.ok(action.invariants?.includes('current_source_visibility'));
  }

  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => {
    try { await closeApp?.(); } finally { await prisma.$disconnect(); }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const database = app.get(PrismaService);
  const users = new Map<string, string>();
  const cookies = new Map<string, string>();
  for (const [login, password] of [['manager1', 'manager123'], ['manager2', 'manager123'], ['stepanova', 'stepanova123'], ['founder', 'founder123']]) {
    users.set(login, (await prisma.user.findUniqueOrThrow({ where: { login } })).id);
    cookies.set(login, await loginAndGetCookieHeader({ baseUrl, login, password }));
  }
  const ownerId = users.get('manager1')!;
  const otherId = users.get('manager2')!;
  const founderId = users.get('founder')!;
  assert.equal(await prisma.userAccessRule.count({ where: { userId: { in: [...users.values()] } } }), 0);
  const marker = `acl-notification-${randomUUID()}`;
  const object = (label: string, owner: boolean, assigned: boolean) => prisma.object.create({ data: {
    id: randomUUID(), name: `${marker}-${label}`, address: 'Isolated notification source', status: 'active',
    createdByUserId: owner ? ownerId : founderId,
    ...(assigned ? { assignments: { create: { userId: ownerId, assignmentRoleCode: 'manager', isActive: true } } } : {}),
  } });
  const objectA = await object('object-A', true, false);
  const objectB = await object('object-B', false, true);
  const hiddenObject = await object('hidden-object', false, false);
  const task = (label: string, objectId: string, owner: boolean, assigned: boolean) => prisma.task.create({ data: {
    id: randomUUID(), title: `${marker}-${label}`, description: 'Real notification task source', priority: 'important_not_urgent',
    status: 'in_progress', objectId, scopeType: 'object', visibilityType: 'private', createdByUserId: owner ? ownerId : founderId,
    dueAt: new Date('2040-01-15T09:00:00Z'), assignees: { create: { userId: assigned ? ownerId : otherId } },
  } });
  const taskA = await task('task-A', objectA.id, true, false);
  const taskB = await task('task-B', objectB.id, false, true);
  const hiddenTask = await task('hidden-task', hiddenObject.id, false, false);
  const candidate = (label: string, owner: boolean, assigned: boolean) => prisma.candidate.create({ data: {
    id: randomUUID(), fullName: `${marker}-${label}`, candidateType: 'reserve', phones: ['+79991234567'],
    createdByUserId: owner ? ownerId : founderId,
    ...(assigned ? { assignments: { create: { managerUserId: ownerId, assignedByUserId: founderId,
      responseDueAt: new Date(Date.now() + 7_200_000) } } } : {}),
  } });
  const candidateA = await candidate('candidate-A', true, false);
  const candidateB = await candidate('candidate-B', false, true);
  const sources: Record<SourceKey, { entityType: string; entityId: string }> = {
    objectA: { entityType: 'object', entityId: objectA.id }, objectB: { entityType: 'object', entityId: objectB.id },
    taskA: { entityType: 'task', entityId: taskA.id }, taskB: { entityType: 'task', entityId: taskB.id },
    candidateA: { entityType: 'candidate', entityId: candidateA.id }, candidateB: { entityType: 'candidate', entityId: candidateB.id },
    hiddenObject: { entityType: 'object', entityId: hiddenObject.id }, hiddenTask: { entityType: 'task', entityId: hiddenTask.id },
    missingObject: { entityType: 'object', entityId: randomUUID() },
  };
  const records: Array<{ id: string; source: SourceKey; login: string }> = [];
  const fixture = async (source: SourceKey, read: boolean, login = 'manager1') => {
    // Persist inbox fixtures directly, without an outbox/publication request.
    // Every source reference except the deliberate missing-source control is real.
    const row = await prisma.notification.create({ data: {
      id: randomUUID(), recipientUserId: users.get(login)!, ...sources[source], type: 'acl.fixture',
      title: `${marker}-${source}`, body: 'Isolated recipient notification', readAt: read ? new Date('2026-10-20T10:00:00Z') : null,
    } });
    records.push({ id: row.id, source, login });
    return row;
  };
  for (const key of ['objectA', 'objectB', 'taskA', 'taskB', 'candidateA', 'candidateB'] as const) {
    await fixture(key, false);
    await fixture(key, true);
  }
  for (const key of ['hiddenObject', 'hiddenTask', 'missingObject'] as const) await fixture(key, false);
  const foreignUnread = await fixture('taskA', false, 'manager2');
  const foreignRead = await fixture('taskA', true, 'manager2');
  const negativeCandidate = await fixture('candidateA', false, 'stepanova');
  const negativeReadCandidate = await fixture('candidateA', true, 'stepanova');
  await fixture('objectA', false, 'stepanova');
  const request = (path: string, method = 'GET', login = 'manager1') => fetch(`${baseUrl}/api/v1/notifications${path}`, {
    method, headers: { Cookie: cookies.get(login)! }, signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, status: number): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, status, text);
    return JSON.parse(text) as T;
  };
  const rule = (actionCode: string, effect: 'allow' | 'deny', scope: Scope, selectedIds: string[] = [], login = 'manager1') => {
    assert.ok(ACCESS_ACTION_CATALOG.find((action) => action.code === actionCode)?.allowedScopes.includes(scope));
    const userId = users.get(login)!;
    return prisma.userAccessRule.upsert({
      where: { userId_actionCode: { userId, actionCode } },
      create: { userId, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds },
    });
  };
  const revoke = (actionCode: string, login = 'manager1') => prisma.userAccessRule.delete({
    where: { userId_actionCode: { userId: users.get(login)!, actionCode } },
  });
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: { in: [...users.values()] },
    OR: ['notifications.', 'objects.', 'tasks.', 'candidates.'].map((prefix) => ({ actionCode: { startsWith: prefix } })),
  } });
  const snapshot = async () => ({
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    objects: await prisma.object.findMany({ where: { name: { startsWith: marker } }, orderBy: { id: 'asc' }, include: { assignments: { orderBy: { id: 'asc' } } } }),
    tasks: await prisma.task.findMany({ where: { title: { startsWith: marker } }, orderBy: { id: 'asc' }, include: {
      assignees: { orderBy: { id: 'asc' }, include: { completions: { orderBy: { id: 'asc' } } } }, historyEvents: { orderBy: { id: 'asc' } },
    } }),
    candidates: await prisma.candidate.findMany({ where: { fullName: { startsWith: marker } }, orderBy: { id: 'asc' }, include: {
      assignments: { orderBy: { id: 'asc' } }, responses: { orderBy: { id: 'asc' } },
    } }),
    audits: await prisma.auditEvent.findMany({ where: { entityType: { in: ['notification', 'object', 'task', 'candidate'] } }, orderBy: { id: 'asc' } }),
  });
  type State = Awaited<ReturnType<typeof snapshot>>;
  const sourcesUnchanged = (before: State, after: State) => {
    for (const key of ['objects', 'tasks', 'candidates', 'audits'] as const) assert.deepEqual(after[key], before[key]);
  };
  const rejected = async (id: string, action: 'read' | 'dismiss', status = 404, login = 'manager1') => {
    const before = await snapshot();
    const response = await request(`/${id}/${action}`, 'POST', login);
    assert.equal(response.status, status, await response.text());
    assert.deepEqual(await snapshot(), before, 'Rejected notification mutations must preserve all recipients, read/dismiss state, sources and audit');
  };
  const inbox = async (login = 'manager1') => {
    const body = await json<NotificationListResponseDto>(await request('?page=1&limit=100', 'GET', login), 200);
    assert.ok(body.total <= 100, 'Bounded isolated fixture must fit the complete comparison page');
    assert.equal(body.total, body.items.length);
    const count = await json<{ count: number }>(await request('/unread-count', 'GET', login), 200);
    assert.equal(count.count, body.items.filter((entry) => entry.readAt === null).length);
    const page = await json<NotificationListResponseDto>(await request('?page=1&limit=1', 'GET', login), 200);
    assert.equal(page.total, body.total);
    assert.equal(page.totalPages, body.total);
    assert.deepEqual(page.items.map((entry) => entry.id), body.items.slice(0, 1).map((entry) => entry.id));
    return body;
  };
  const realtimeEligible = async (login = 'manager1') => database.notification.findMany({
    where: await notificationAccessWhere(database, users.get(login)!, 'notifications.realtime'), select: { id: true }, orderBy: { id: 'asc' },
  });
  const permanentHidden = new Set<SourceKey>(['hiddenObject', 'hiddenTask', 'missingObject']);
  const assertInbox = async (hidden: SourceKey[] = [], login = 'manager1', empty = false) => {
    const before = await snapshot();
    const body = await inbox(login);
    const excluded = new Set([...permanentHidden, ...hidden]);
    const expected = records.filter((record) => record.login === login && !empty && !excluded.has(record.source)
      && !before.notifications.find((row) => row.id === record.id)!.dismissedAt).map((record) => record.id);
    assert.deepEqual(new Set(body.items.filter((entry) => records.some((record) => record.id === entry.id)).map((entry) => entry.id)), new Set(expected));
    if (empty) assert.equal(body.total, 0);
    assert.deepEqual(new Set((await realtimeEligible(login)).map((row) => row.id)), new Set(body.items.map((entry) => entry.id)),
      'Compare real DB delivery eligibility only; this is not a publication or socket-delivery assertion');
    assert.deepEqual(await snapshot(), before);
    return body;
  };
  const markAll = async (hiddenIds: string[] = []) => {
    const visible = await inbox();
    const eligible = new Set(visible.items.filter((entry) => entry.readAt === null).map((entry) => entry.id));
    const before = await snapshot();
    const result = await json<{ updated: number }>(await request('/read-all', 'POST'), 201);
    const after = await snapshot();
    assert.equal(result.updated, eligible.size);
    assert.equal(after.notifications.length, before.notifications.length);
    for (const row of after.notifications) {
      const previous = before.notifications.find((entry) => entry.id === row.id)!;
      if (eligible.has(row.id)) {
        assert.ok(row.readAt);
        assert.deepEqual(row, { ...previous, readAt: row.readAt });
      } else assert.deepEqual(row, previous);
      if (hiddenIds.includes(row.id)) assert.deepEqual(row, previous, 'Bulk marking must not change a hidden source notification');
    }
    sourcesUnchanged(before, after);
  };

  await t.test('own/all read and module allow/deny/default/revoke retain recipient ownership and pagination/count agreement', async () => {
    await assertInbox();
    const otherInbox = await inbox('manager2');
    assert.ok(otherInbox.items.some((entry) => entry.id === foreignUnread.id));
    assert.ok(otherInbox.items.some((entry) => entry.id === foreignRead.id));
    const ownRead = await prisma.notification.findFirstOrThrow({ where: {
      recipientUserId: ownerId, entityType: 'object', entityId: objectA.id, readAt: { not: null },
    } });
    for (const suffix of ['mark_read', 'dismiss', 'realtime']) await rule(`notifications.${suffix}`, 'allow', 'all');
    for (const scope of ['own', 'all'] as const) {
      await rule('notifications.read', 'allow', scope);
      await assertInbox();
      await rejected(foreignUnread.id, 'read');
      await rejected(foreignRead.id, 'dismiss');
      await rule('notifications.read', 'deny', scope);
      await assertInbox([], 'manager1', true);
      await rejected(records.find((record) => record.source === 'objectA' && record.login === 'manager1')!.id, 'read');
      await rejected(ownRead.id, 'dismiss');
      const before = await snapshot();
      assert.equal((await json<{ updated: number }>(await request('/read-all', 'POST'), 201)).updated, 0);
      assert.deepEqual(await snapshot(), before);
      await revoke('notifications.read');
      await assertInbox();
      await rule('notifications.access', 'allow', scope);
      await assertInbox();
      await rule('notifications.access', 'deny', scope);
      await assertInbox([], 'manager1', true);
      await rejected(ownRead.id, 'dismiss');
      await rejected(records.find((record) => record.source === 'objectA' && record.login === 'manager1')!.id, 'read');
      await revoke('notifications.access');
      await assertInbox();
    }
  });

  await t.test('mark_read own/all denies block individual and bulk writes; allow/default are idempotent and cannot touch another recipient', async () => {
    await reset();
    for (const scope of ['own', 'all'] as const) {
      const row = await fixture('objectA', false);
      await rule('notifications.mark_read', 'deny', scope);
      await rejected(row.id, 'read');
      const beforeDeniedBulk = await snapshot();
      assert.equal((await json<{ updated: number }>(await request('/read-all', 'POST'), 201)).updated, 0);
      assert.deepEqual(await snapshot(), beforeDeniedBulk);
      await rule('notifications.mark_read', 'allow', scope);
      const before = await snapshot();
      const result = await json<NotificationResponseDto>(await request(`/${row.id}/read`, 'POST'), 201);
      const after = await snapshot();
      const stored = after.notifications.find((entry) => entry.id === row.id)!;
      assert.ok(stored.readAt);
      assert.equal(result.readAt, stored.readAt.toISOString());
      assert.deepEqual(stored, { ...row, readAt: stored.readAt });
      assert.deepEqual(after.notifications.filter((entry) => entry.id !== row.id), before.notifications.filter((entry) => entry.id !== row.id));
      sourcesUnchanged(before, after);
      await json(await request(`/${row.id}/read`, 'POST'), 201);
      assert.deepEqual(await snapshot(), after);
      await rejected(foreignUnread.id, 'read');
      await revoke('notifications.mark_read');
      const restored = await fixture('objectB', false);
      await json(await request(`/${restored.id}/read`, 'POST'), 201);
      assert.ok((await prisma.notification.findUniqueOrThrow({ where: { id: restored.id } })).readAt);
    }
    await markAll(records.filter((record) => permanentHidden.has(record.source)).map((record) => record.id));
  });

  await t.test('dismiss own/all requires a read row, is idempotent and never deletes shared notifications or source records', async () => {
    await reset();
    for (const scope of ['own', 'all'] as const) {
      const unread = await fixture('objectA', false);
      const read = await fixture('objectA', true);
      await rule('notifications.dismiss', 'allow', scope);
      await rejected(unread.id, 'dismiss', 400);
      await rejected(foreignRead.id, 'dismiss');
      await rule('notifications.dismiss', 'deny', scope);
      await rejected(read.id, 'dismiss');
      await rule('notifications.dismiss', 'allow', scope);
      const before = await snapshot();
      await json(await request(`/${read.id}/dismiss`, 'POST'), 201);
      const after = await snapshot();
      const saved = after.notifications.find((entry) => entry.id === read.id)!;
      assert.ok(saved.dismissedAt);
      assert.deepEqual(saved, { ...read, dismissedAt: saved.dismissedAt });
      assert.deepEqual(after.notifications.filter((entry) => entry.id !== read.id), before.notifications.filter((entry) => entry.id !== read.id));
      sourcesUnchanged(before, after);
      await json(await request(`/${read.id}/dismiss`, 'POST'), 201);
      assert.deepEqual(await snapshot(), after);
      await rejected(read.id, 'read');
      assert.ok(!(await inbox()).items.some((entry) => entry.id === read.id));
      await revoke('notifications.dismiss');
      const defaultRead = await fixture('objectB', true);
      await json(await request(`/${defaultRead.id}/dismiss`, 'POST'), 201);
      assert.ok((await prisma.notification.findUniqueOrThrow({ where: { id: defaultRead.id } })).dismissedAt);
    }
  });

  for (const module of ['candidates', 'tasks', 'objects'] as const) {
    await t.test(`${module} own/assigned/selected/all source denies filter before counts and prevent mark/dismiss despite notification all grants`, async () => {
      for (const scope of ['own', 'assigned', 'selected', 'all'] as const) {
        await reset();
        for (const action of actions) await rule(action.code, 'allow', 'all');
        const aKey: SourceKey = module === 'candidates' ? 'candidateA' : module === 'tasks' ? 'taskA' : 'objectA';
        const bKey: SourceKey = module === 'candidates' ? 'candidateB' : module === 'tasks' ? 'taskB' : 'objectB';
        const affected: SourceKey[] = scope === 'all' ? [aKey, bKey] : [scope === 'assigned' ? bKey : aKey];
        const hidden: SourceKey[] = module === 'objects'
          ? [...affected, ...affected.map((key): SourceKey => key === 'objectA' ? 'taskA' : 'taskB')] : affected;
        const actionCode = `${module}.${module === 'candidates' ? 'view' : 'read'}`;
        await rule(actionCode, 'deny', scope, scope === 'selected' ? [sources[aKey].entityId] : []);
        const blockedUnread = await fixture(affected[0], false);
        const blockedRead = await fixture(affected[0], true);
        await assertInbox(hidden);
        await rejected(blockedUnread.id, 'read');
        await rejected(blockedRead.id, 'dismiss');
        await markAll(records.filter((record) => hidden.includes(record.source) || permanentHidden.has(record.source)).map((record) => record.id));
        assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: blockedUnread.id } })).readAt, null);
        await revoke(actionCode);
        await assertInbox();
        await json(await request(`/${blockedUnread.id}/read`, 'POST'), 201);
        assert.ok((await prisma.notification.findUniqueOrThrow({ where: { id: blockedUnread.id } })).readAt);
      }
      await reset();
      const selectedKey: SourceKey = module === 'candidates' ? 'candidateA' : module === 'tasks' ? 'taskA' : 'objectA';
      await rule(`${module}.access`, 'deny', 'selected', [sources[selectedKey].entityId]);
      await assertInbox(module === 'objects' ? ['objectA', 'taskA'] : [selectedKey]);
      await reset();
    });
  }

  await t.test('existing candidates.denied beats notification/candidate all grants while a non-candidate control remains visible', async () => {
    await reset();
    const userId = users.get('stepanova')!;
    assert.ok(await prisma.userPermission.findFirst({ where: { userId, permission: { code: 'candidates.denied' } } }));
    for (const action of actions) await rule(action.code, 'allow', 'all', [], 'stepanova');
    await rule('candidates.view', 'allow', 'all', [], 'stepanova');
    await rule('candidates.access', 'allow', 'all', [], 'stepanova');
    await assertInbox(['candidateA', 'candidateB'], 'stepanova');
    await rejected(negativeCandidate.id, 'read', 404, 'stepanova');
    await rejected(negativeReadCandidate.id, 'dismiss', 404, 'stepanova');
    const before = await snapshot();
    await json(await request('/read-all', 'POST', 'stepanova'), 201);
    const after = await snapshot();
    assert.deepEqual(after.notifications.find((entry) => entry.id === negativeCandidate.id), before.notifications.find((entry) => entry.id === negativeCandidate.id));
    sourcesUnchanged(before, after);
    await reset();
  });

  await t.test('realtime own/all rules gate real DB eligibility only; HTTP inbox remains independent and no socket delivery is claimed', async () => {
    await reset();
    for (const scope of ['own', 'all'] as const) {
      await rule('notifications.realtime', 'allow', scope);
      const expected = await assertInbox();
      await rule('notifications.realtime', 'deny', scope);
      const before = await snapshot();
      assert.deepEqual(await realtimeEligible(), []);
      assert.deepEqual((await inbox()).items.map((entry) => entry.id), expected.items.map((entry) => entry.id));
      assert.deepEqual(await snapshot(), before);
      await revoke('notifications.realtime');
      await assertInbox();
    }
    await reset();
    // No Redis publication, outbox scheduling or WebSocket delivery assertions.
    // The sequential runner drops this isolated schema and all source/inbox fixtures.
  });

  await t.test('returning realtime access does not enqueue notifications received during a deny', async () => {
    const notifications = app.get(NotificationsService);
    for (const scope of ['own', 'all'] as const) {
      const params = {
        recipientUserId: ownerId,
        type: 'acl.fixture',
        title: marker,
        dedupeKey: `${marker}-realtime-denied-${scope}`,
      };
      await rule('notifications.realtime', 'deny', scope);
      const quiet = await notifications.create(params);
      const unkeyed = await notifications.create({ ...params, dedupeKey: null });
      assert.ok((await inbox()).items.some((entry) => entry.id === quiet.id));
      await revoke('notifications.realtime');
      assert.equal((await notifications.create(params)).id, quiet.id);
      assert.equal(await prisma.notificationOutbox.count({
        where: { notificationId: { in: [quiet.id, unkeyed.id] } },
      }), 0);
      const fresh = await notifications.create({ ...params, dedupeKey: null });
      assert.equal(await prisma.notificationOutbox.count({ where: { notificationId: fresh.id } }), 1);
    }
  });
});
