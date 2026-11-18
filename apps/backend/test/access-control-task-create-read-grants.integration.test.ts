import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { TaskResponseDto } from '../src/modules/tasks/dto/task-response.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('task create admits only a readable generated resource and rolls back denied graphs atomically', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));

  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => { try { await closeApp?.(); } finally { await prisma.$disconnect(); } });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const actor = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const performer = await prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const performerCookie = await loginAndGetCookieHeader({ baseUrl, login: performer.login, password: 'manager123' });
  const outsiderCookie = await loginAndGetCookieHeader({ baseUrl, login: 'hr1', password: 'hr123' });
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id } }), 0);
  const identity = () => prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: {
    id: true, login: true, fullName: true, isActive: true, roles: { select: { roleId: true }, orderBy: { roleId: 'asc' } },
  } });
  const originalIdentity = await identity();
  const marker = `acl-task-create-read-${randomUUID()}`;
  let sequence = 0;
  const payload = (extra: Record<string, unknown> = {}) => ({
    title: `${marker}-${++sequence}`, description: 'Atomic task create admission', priority: 'important_not_urgent',
    assigneeUserIds: [performer.id], visibilityType: 'private', visibleUserIds: [],
    requiresConfirmation: true, completionRequirement: 'comment_required', dueDate: '2040-01-15', ...extra,
  });
  const request = (path: string, method = 'GET', body?: unknown, authCookie = cookie) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: authCookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, status: number): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, status, text);
    return JSON.parse(text) as T;
  };
  const rule = (actionCode: string, effect: 'allow' | 'deny', scope: 'own' | 'assigned' | 'selected' | 'all', selectedIds: string[] = []) => {
    const definition = ACCESS_ACTION_CATALOG.find((entry) => entry.code === actionCode)!;
    assert.equal(definition.manageable, true);
    assert.ok(definition.allowedScopes.includes(scope));
    return prisma.userAccessRule.upsert({
      where: { userId_actionCode: { userId: actor.id, actionCode } },
      create: { userId: actor.id, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds },
    });
  };
  const revoke = (actionCode: string) => prisma.userAccessRule.delete({ where: { userId_actionCode: { userId: actor.id, actionCode } } });
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: actor.id } });
  const snapshot = async () => ({
    tasks: await prisma.task.findMany({ where: { title: { startsWith: marker } }, orderBy: { id: 'asc' } }),
    assignees: await prisma.taskAssignee.findMany({ orderBy: { id: 'asc' } }),
    visibilityUsers: await prisma.taskVisibilityUser.findMany({ orderBy: { id: 'asc' } }),
    history: await prisma.taskHistoryEvent.findMany({ orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ where: { entityType: 'task' }, orderBy: { id: 'asc' } }),
    outbox: await prisma.notificationOutbox.findMany({ where: { notification: { entityType: 'task' } },
      select: { id: true, notificationId: true, recipientUserId: true }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditEvent.findMany({ where: { entityType: { in: ['task', 'approval_request'] } }, orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ where: { sourceEntityType: 'task' }, orderBy: { id: 'asc' } }),
  });
  const denied = async (body: ReturnType<typeof payload>) => {
    const before = await snapshot();
    const response = await request('/tasks', 'POST', body);
    const text = await response.text();
    assert.equal(response.status, 403, text);
    assert.deepEqual(await snapshot(), before, 'No task, assignee, visibility, history, audit, approval, notification or outbox may survive denied admission');
    assert.equal(await prisma.task.count({ where: { title: body.title } }), 0);
    assert.deepEqual(await identity(), originalIdentity);
  };
  const create = async (body: ReturnType<typeof payload>) => {
    const result = await json<TaskResponseDto>(await request('/tasks', 'POST', body), 201);
    assert.equal(result.createdBy.id, actor.id);
    assert.equal(result.title, body.title);
    assert.equal((await json<TaskResponseDto>(await request(`/tasks/${result.id}`), 200)).id, result.id);
    assert.equal(await prisma.task.count({ where: { title: body.title } }), 1);
    const stored = await prisma.task.findUniqueOrThrow({ where: { id: result.id }, include: {
      assignees: true, visibilityUsers: true, historyEvents: true,
    } });
    assert.equal(stored.createdByUserId, actor.id);
    assert.deepEqual(stored.assignees.map((entry) => entry.userId).sort(), [...body.assigneeUserIds].sort());
    assert.ok(stored.assignees.every((entry) => entry.isActive && !entry.isCompleted));
    assert.equal(stored.historyEvents.length, 1);
    assert.equal(stored.historyEvents[0].eventType, 'task.created');
    assert.equal(stored.historyEvents[0].actorUserId, actor.id);
    assert.equal(await prisma.notification.count({ where: { entityType: 'task', entityId: result.id, type: 'task.assigned', recipientUserId: performer.id } }), 1);
    assert.deepEqual(await identity(), originalIdentity);
    return result;
  };

  await t.test('legacy active creator reads private task, assignee reads it, unrelated non-leadership user cannot', async () => {
    const created = await create(payload());
    await json(await request(`/tasks/${created.id}`, 'GET', undefined, performerCookie), 200);
    const outsider = await request(`/tasks/${created.id}`, 'GET', undefined, outsiderCookie);
    assert.equal(outsider.status, 404, await outsider.text());
  });

  for (const [actionCode, scope] of [['tasks.access', 'own'], ['tasks.read', 'own'], ['tasks.read', 'all'], ['tasks.access', 'all']] as const) {
    await t.test(`create allow all cannot bypass ${actionCode} deny ${scope}; same payload succeeds once after deny removal with old cookie`, async () => {
      await reset();
      await rule('tasks.create', 'allow', 'all');
      await rule(actionCode, 'deny', scope);
      const body = payload({ visibilityType: 'selected_users', visibleUserIds: [actor.id] });
      await denied(body);
      await revoke(actionCode);
      const created = await create(body);
      assert.equal(await prisma.taskVisibilityUser.count({ where: { taskId: created.id, userId: actor.id } }), 1);
    });
  }

  await t.test('assigned deny evaluates real proposed assignees, not just creator or a context-free global projection', async () => {
    await reset();
    await rule('tasks.create', 'allow', 'all');
    await rule('tasks.read', 'deny', 'assigned');
    const selfAssigned = payload({ assigneeUserIds: [actor.id, performer.id] });
    await denied(selfAssigned);
    // Same deny must not prevent creating an owned private task assigned only to another user.
    await create(payload());
    await revoke('tasks.read');
    await create(selfAssigned);
  });

  await t.test('selected task deny applies to actual ids only, never every newly generated task', async () => {
    await reset();
    const existing = await create(payload());
    await rule('tasks.create', 'allow', 'all');
    await rule('tasks.read', 'deny', 'selected', [existing.id]);
    const created = await create(payload());
    assert.notEqual(created.id, existing.id);
    const hidden = await request(`/tasks/${existing.id}`);
    assert.equal(hidden.status, 404, await hidden.text());
  });

  const object = await prisma.object.create({ data: {
    name: `${marker}-parent`, address: 'Isolated task admission', status: 'active', createdByUserId: founder.id,
    assignments: { create: { userId: actor.id, assignmentRoleCode: 'manager', isActive: true } },
  } });
  for (const code of ['objects.access', 'objects.read']) {
    await t.test(`${code} selected parent deny rolls back otherwise valid target-participant creation`, async () => {
      await reset();
      await rule('tasks.create', 'allow', 'all');
      await rule(code, 'deny', 'selected', [object.id]);
      const body = payload({ objectId: object.id, visibilityType: 'target_participants' });
      await denied(body);
      await revoke(code);
      const created = await create(body);
      assert.equal(created.objectId, object.id);
    });
  }

  const order = await prisma.oneTimeOrder.create({ data: {
    title: `${marker}-order`, executionAddress: 'Isolated task admission', contactName: 'Fixture',
    status: 'in_progress', createdByUserId: founder.id,
    assignments: { create: { userId: actor.id, assignmentRoleCode: 'one_time_manager', isActive: true } },
  } });
  for (const code of ['one_time_orders.access', 'one_time_orders.read']) {
    await t.test(`${code} selected parent deny is checked by SQL before child publication`, async () => {
      await reset();
      await rule('tasks.create', 'allow', 'all');
      await rule(code, 'deny', 'selected', [order.id]);
      const body = payload({ oneTimeOrderId: order.id, visibilityType: 'target_participants' });
      await denied(body);
      await revoke(code);
      const created = await create(body);
      assert.equal(created.oneTimeOrderId, order.id);
    });
  }

  await reset();
  assert.deepEqual(await identity(), originalIdentity);
});
