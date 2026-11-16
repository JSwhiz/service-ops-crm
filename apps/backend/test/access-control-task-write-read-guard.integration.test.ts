import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { TaskResponseDto } from '../src/modules/tasks/dto/task-response.dto';
import { TasksService } from '../src/modules/tasks/tasks.service';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Operation = 'undo' | 'cancel' | 'add' | 'remove';

test('read-returning task writes reject selected task.read deny before commit despite leaf allow', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.MINIO_ENDPOINT ?? '127.0.0.1'));
  if (process.env.REDIS_HOST) assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.REDIS_HOST));
  if (process.env.REDIS_URL) assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.REDIS_URL).hostname));
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => { try { await closeApp?.(); } finally { await prisma.$disconnect(); } });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const actor = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const other = await prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } });
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const authorCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id } }), 0);
  const marker = `acl-task-write-read-${randomUUID()}`;
  const ids: string[] = [];
  let sequence = 0;
  const request = (path: string, method = 'GET', body?: unknown, auth = cookie) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: auth, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, status: number): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, status, text);
    return JSON.parse(text) as T;
  };
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: actor.id } });
  const rule = (actionCode: string, effect: 'allow' | 'deny', scope: 'selected' | 'all', selectedIds: string[] = []) => {
    const entry = ACCESS_ACTION_CATALOG.find((item) => item.code === actionCode)!;
    assert.equal(entry.manageable, true);
    assert.ok(entry.allowedScopes.includes(scope));
    return prisma.userAccessRule.upsert({
      where: { userId_actionCode: { userId: actor.id, actionCode } },
      create: { userId: actor.id, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds },
    });
  };
  const snapshot = async () => ({
    actor: await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: {
      id: true, login: true, roles: { select: { roleId: true }, orderBy: { roleId: 'asc' } },
      permissions: { select: { permissionId: true }, orderBy: { permissionId: 'asc' } },
    } }),
    tasks: await prisma.task.findMany({ where: { id: { in: ids } }, include: {
      assignees: { orderBy: { id: 'asc' }, include: { completions: { orderBy: { id: 'asc' } } } },
      visibilityUsers: { orderBy: { id: 'asc' } }, historyEvents: { orderBy: { id: 'asc' } },
    }, orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ where: { sourceEntityType: 'task' }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    outbox: await prisma.notificationOutbox.findMany({ select: { id: true, notificationId: true, recipientUserId: true }, orderBy: { id: 'asc' } }),
    files: await prisma.fileAttachment.findMany({ orderBy: { id: 'asc' } }),
    payments: await prisma.oneTimeOrderCompletionPayment.findMany({ orderBy: { id: 'asc' } }),
    funding: await prisma.accountabilityFunding.findMany({ orderBy: { id: 'asc' } }),
    expenses: await prisma.accountabilityExpense.findMany({ orderBy: { id: 'asc' } }),
    movements: await prisma.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
  });
  type State = Awaited<ReturnType<typeof snapshot>>;
  const immutableFailure = async (operation: () => Promise<Response>, expected: number) => {
    const before = await snapshot();
    const response = await operation();
    const text = await response.text();
    assert.deepEqual(await snapshot(), before, 'Authorization denial cannot commit a mutation and then fail DTO read after commit');
    assert.equal(response.status, expected, text);
  };
  const create = async (operation: Operation) => {
    const task = await json<TaskResponseDto>(await request('/tasks', 'POST', {
      title: `${marker}-${operation}-${++sequence}`, priority: 'important_not_urgent',
      assigneeUserIds: operation === 'remove' ? [actor.id, other.id] : [actor.id],
      visibilityType: 'private', requiresConfirmation: true, completionRequirement: 'comment_required', dueDate: '2040-01-15',
    }, authorCookie), 201);
    ids.push(task.id);
    if (operation === 'undo') {
      const completed = await json<TaskResponseDto>(await request(`/tasks/${task.id}/assignees/me/complete`, 'POST', { completionText: 'Retained submitted result' }), 201);
      assert.equal(completed.status, 'awaiting_confirmation');
    }
    return task;
  };
  const invoke = (operation: Operation, id: string) => operation === 'undo'
    ? request(`/tasks/${id}/assignees/me/undo-completion`, 'POST')
    : operation === 'cancel' ? request(`/tasks/${id}/cancel`, 'POST', { reason: 'Explicit cancellation reason' })
      : operation === 'add' ? request(`/tasks/${id}/assignees`, 'POST', { userIds: [other.id] })
        : request(`/tasks/${id}/assignees/${other.id}`, 'DELETE');
  const taskState = (state: State, id: string) => {
    const task = state.tasks.find((row) => row.id === id);
    assert.ok(task);
    return task;
  };
  const assertChanged = (before: State, after: State, id: string, operation: Operation) => {
    const previous = taskState(before, id), saved = taskState(after, id);
    assert.equal(saved.createdByUserId, founder.id);
    assert.equal(saved.workCycle, previous.workCycle);
    const eventType = operation === 'undo' ? 'task.assignee_completion_cancelled' : operation === 'cancel' ? 'task.cancelled'
      : operation === 'add' ? 'task.assignee_added' : 'task.assignee_removed';
    assert.equal(saved.historyEvents.filter((event) => event.eventType === eventType && event.actorUserId === actor.id).length, 1);
    if (operation === 'undo') {
      assert.equal(saved.status, 'in_progress');
      assert.equal(saved.assignees[0].isCompleted, false);
      assert.equal(saved.assignees[0].completions[0].status, 'cancelled');
      assert.equal(after.approvals.find((entry) => entry.sourceEntityId === id)?.status, 'cancelled');
    } else if (operation === 'cancel') {
      assert.equal(saved.status, 'cancelled');
      assert.equal(saved.cancelledByUserId, actor.id);
      assert.equal(saved.cancellationReason, 'Explicit cancellation reason');
    } else if (operation === 'add') {
      assert.equal(saved.assignees.filter((entry) => entry.userId === other.id && entry.isActive).length, 1);
      assert.equal(saved.assignees.length, 2);
    } else {
      assert.equal(saved.assignees.find((entry) => entry.userId === other.id)!.isActive, false);
      assert.equal(saved.assignees.find((entry) => entry.userId === other.id)!.removedByUserId, actor.id);
      assert.equal(saved.assignees.find((entry) => entry.userId === actor.id)!.isActive, true);
    }
    assert.deepEqual(after.tasks.filter((entry) => entry.id !== id), before.tasks.filter((entry) => entry.id !== id), 'Control task must not change');
    assert.deepEqual(after.actor, before.actor, 'A grant does not change actor identity or roles');
    for (const key of ['files', 'payments', 'funding', 'expenses', 'movements'] as const) assert.deepEqual(after[key], before[key]);
  };

  for (const operation of ['undo', 'cancel', 'add', 'remove'] as const) {
    await t.test(`${operation}: opened A read-deny plus leaf allow never commits; B and explicit regrant preserve normal flow`, async () => {
      await reset();
      const a = await create(operation), b = await create(operation);
      const actionCode = operation === 'undo' ? 'tasks.completion.undo' : operation === 'cancel' ? 'tasks.cancel' : 'tasks.assignees.manage';
      const beforeGrant = await snapshot();
      await rule(actionCode, 'allow', 'all');
      assert.deepEqual(await snapshot(), beforeGrant, 'Saving the rule cannot add membership or mutate the task');
      await json<TaskResponseDto>(await request(`/tasks/${a.id}`), 200);
      await json<TaskResponseDto>(await request(`/tasks/${b.id}`), 200);
      await rule('tasks.read', 'deny', 'selected', [a.id]);
      await immutableFailure(() => invoke(operation, a.id), 403);
      await immutableFailure(() => request(`/tasks/${a.id}`), 404);
      const beforeB = await snapshot();
      const bodyB = await json<TaskResponseDto>(await invoke(operation, b.id), operation === 'remove' ? 200 : 201);
      assert.equal(bodyB.id, b.id);
      assertChanged(beforeB, await snapshot(), b.id, operation);
      await immutableFailure(() => invoke(operation, a.id), 403);
      // Same payload and original cookie; no automatic replay or synthetic membership.
      await rule('tasks.read', 'allow', 'selected', [a.id]);
      await json<TaskResponseDto>(await request(`/tasks/${a.id}`), 200);
      const beforeA = await snapshot();
      const bodyA = await json<TaskResponseDto>(await invoke(operation, a.id), operation === 'remove' ? 200 : 201);
      assert.equal(bodyA.id, a.id);
      assertChanged(beforeA, await snapshot(), a.id, operation);
    });
  }

  const saveRule = async (change: { actionCode: string; effect: 'allow' | 'deny'; scope: 'selected'; selectedIds: string[] }) => {
    const { accessVersion } = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { accessVersion: true } });
    const payload = { expectedVersion: accessVersion, reason: 'Isolated task access acceptance', changes: [change] };
    const endpoint = `/users-access/admin/users/${actor.id}`;
    const { previewToken, previewHash } = await json<{ previewToken: string; previewHash: string }>(await request(`${endpoint}/preview`, 'POST', payload, authorCookie), 201);
    await json(await request(`${endpoint}/save`, 'POST', { ...payload, previewToken, previewHash }, authorCookie), 201);
  };

  await t.test('self-removal commits once and returns only the success receipt when access disappears', async () => {
    await reset();
    const task = await create('remove');
    await saveRule({ actionCode: 'tasks.assignees.manage', effect: 'allow', scope: 'selected', selectedIds: [task.id] });
    await json(await request(`/tasks/${task.id}`), 200);
    const result = await json(await request(`/tasks/${task.id}/assignees/${actor.id}`, 'DELETE'), 200);
    assert.deepEqual(result, { outcome: 'saved_without_access' });
    const saved = taskState(await snapshot(), task.id);
    assert.equal(saved.assignees.find(row => row.userId === actor.id)?.isActive, false);
    assert.equal(saved.assignees.find(row => row.userId === other.id)?.isActive, true);
    assert.equal(saved.historyEvents.filter(event => event.eventType === 'task.assignee_removed' && event.actorUserId === actor.id).length, 1);
    await immutableFailure(() => request(`/tasks/${task.id}`), 404);
    await immutableFailure(() => request(`/tasks/${task.id}/assignees/${actor.id}`, 'DELETE'), 403);
  });

  await t.test('target read deny rejects relink before changing the task or history', async () => {
    await reset();
    const task = await json<TaskResponseDto>(await request('/tasks', 'POST', {
      title: `${marker}-relink`, priority: 'important_not_urgent', assigneeUserIds: [other.id],
      visibilityType: 'private', dueDate: '2040-01-15',
    }), 201);
    ids.push(task.id);
    const object = await prisma.object.create({ data: { name: `${marker}-target`, address: 'Test', status: 'active', createdByUserId: actor.id } });
    await saveRule({ actionCode: 'objects.read', effect: 'deny', scope: 'selected', selectedIds: [object.id] });
    await immutableFailure(() => request(`/tasks/${task.id}`, 'PATCH', { objectId: object.id }), 403);
    assert.equal(taskState(await snapshot(), task.id).objectId, null);
  });

  await t.test('founder revoke after authentication but before write rejects the stale request', async () => {
    await reset();
    const task = await create('remove');
    await saveRule({ actionCode: 'tasks.assignees.manage', effect: 'allow', scope: 'selected', selectedIds: [task.id] });
    type ActorLock = { lockTaskActorAccess: (...args: unknown[]) => Promise<void> };
    const service = app.get(TasksService) as unknown as ActorLock;
    const original = service.lockTaskActorAccess;
    let entered!: () => void, resume!: () => void;
    const atLock = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { resume = resolve; });
    service.lockTaskActorAccess = async function (...args) {
      entered();
      await gate;
      return original.apply(this, args);
    };
    const pending = request(`/tasks/${task.id}/assignees/${actor.id}`, 'DELETE');
    try {
      await Promise.race([atLock, pending.then(response => { throw new Error(`Write did not reach transaction guard: ${response.status}`); })]);
      await saveRule({ actionCode: 'tasks.assignees.manage', effect: 'deny', scope: 'selected', selectedIds: [task.id] });
      const before = await snapshot();
      resume();
      await json(await pending, 403);
      assert.deepEqual(await snapshot(), before);
    } finally {
      resume();
      service.lockTaskActorAccess = original;
      await pending.catch(() => undefined);
    }
  });
  await reset();
  // Only the isolated runner drops this fixture's schema; no shared data cleanup.
});
