import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { TaskResponseDto } from '../src/modules/tasks/dto/task-response.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type Scope = 'own' | 'assigned' | 'selected' | 'all';

test('task leaf grants enforce real author, assignee and review workflows with persisted effects', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  const actions = ACCESS_ACTION_CATALOG.filter((action) => action.module === 'tasks');
  assert.deepEqual(actions.map((action) => action.code).sort(), [
    'access', 'read', 'create', 'update', 'status', 'assignees.manage', 'result.submit',
    'completion.draft', 'completion.submit', 'completion.undo', 'confirm', 'complete_now',
    'return', 'reopen', 'cancel', 'history',
  ].map((suffix) => `tasks.${suffix}`).sort());
  const unsupported = actions.find((action) => action.code === 'tasks.status')!;
  assert.equal(unsupported.manageable, false);
  assert.equal(unsupported.constraint, 'unsupported_standalone_operation');

  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => {
    try { await closeApp?.(); } finally { await prisma.$disconnect(); }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const credentials = [['founder', 'founder123'], ['manager1', 'manager123'], ['manager2', 'manager123'], ['hr1', 'hr123']] as const;
  const users = new Map<string, string>();
  const cookies = new Map<string, string>();
  for (const [login, password] of credentials) {
    users.set(login, (await prisma.user.findUniqueOrThrow({ where: { login } })).id);
    cookies.set(login, await loginAndGetCookieHeader({ baseUrl, login, password }));
  }
  const actorId = users.get('manager1')!;
  const performerId = users.get('manager2')!;
  assert.equal(await prisma.userAccessRule.count({ where: { userId: { in: [...users.values()] } } }), 0);
  const marker = `acl-task-${randomUUID()}`;
  let sequence = 0;
  const request = (login: string, path: string, method = 'GET', body?: unknown) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookies.get(login)!, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, status: number): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, status, text);
    return JSON.parse(text) as T;
  };
  const rule = (suffix: string, effect: 'allow' | 'deny', scope: Scope, selectedIds: string[] = [], module = 'tasks') => {
    const actionCode = `${module}.${suffix}`;
    const definition = ACCESS_ACTION_CATALOG.find((action) => action.code === actionCode)!;
    assert.equal(definition.manageable, true, 'Never synthesize a grant for unsupported tasks.status');
    assert.ok(definition.allowedScopes.includes(scope));
    return prisma.userAccessRule.upsert({
      where: { userId_actionCode: { userId: actorId, actionCode } },
      create: { userId: actorId, actionCode, effect, scope, selectedIds }, update: { effect, scope, selectedIds },
    });
  };
  const revoke = (suffix: string, module = 'tasks') => prisma.userAccessRule.delete({
    where: { userId_actionCode: { userId: actorId, actionCode: `${module}.${suffix}` } },
  });
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: actorId,
    OR: [{ actionCode: { startsWith: 'tasks.' } }, { actionCode: { in: ['objects.access', 'objects.read'] } }],
  } });
  const input = (options: Record<string, unknown> = {}) => ({
    title: `${marker}-${++sequence}`, description: 'Isolated task ACL fixture', priority: 'important_not_urgent',
    assigneeUserIds: [performerId], visibilityType: 'selected_users', visibleUserIds: [actorId],
    requiresConfirmation: true, completionRequirement: 'comment_required', dueDate: '2040-01-15', ...options,
  });
  const create = (options: Record<string, unknown> = {}, login = 'founder') => request(login, '/tasks', 'POST', input(options))
    .then((response) => json<TaskResponseDto>(response, 201));
  const card = (id: string, login = 'manager1') => request(login, `/tasks/${id}`).then((response) => json<TaskResponseDto>(response, 200));
  const snapshot = async () => ({
    tasks: await prisma.task.findMany({ where: { title: { startsWith: marker } }, orderBy: { id: 'asc' }, include: {
      assignees: { orderBy: { id: 'asc' }, include: { completions: { orderBy: { id: 'asc' } } } },
      visibilityUsers: { orderBy: { id: 'asc' } }, historyEvents: { orderBy: { id: 'asc' } },
    } }),
    approvals: await prisma.approvalRequest.findMany({ where: { sourceEntityType: 'task' }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditEvent.findMany({ where: { entityType: { in: ['task', 'approval_request'] } }, orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ where: { entityType: 'task' }, orderBy: { id: 'asc' } }),
    objects: await prisma.object.findMany({ where: { name: { startsWith: marker } }, orderBy: { id: 'asc' } }),
    attachments: await prisma.fileAttachment.findMany({ where: { entityType: { in: ['task', 'task_assignee_completion'] } }, orderBy: { id: 'asc' } }),
  });
  type State = Awaited<ReturnType<typeof snapshot>>;
  const storedTask = (state: State, id: string) => {
    const task = state.tasks.find((entry) => entry.id === id);
    assert.ok(task);
    return task;
  };
  const denied = async (id: string, suffix: string, method = 'POST', body?: unknown, status = 403, login = 'manager1') => {
    const before = await snapshot();
    const path = id ? `/tasks/${id}${suffix}` : '/tasks';
    const response = await request(login, path, method, body);
    const text = await response.text();
    const after = await snapshot();
    assert.equal(response.status, status, `${login}: ${method} ${path}: ${text}`);
    assert.deepEqual(after, before, 'Denied/invalid task requests must preserve assignments, completions, cycles, approvals, notifications, attachments, parent objects and audit/history');
  };
  const unrelated = (before: State, after: State, id: string) => {
    assert.deepEqual(after.tasks.filter((entry) => entry.id !== id), before.tasks.filter((entry) => entry.id !== id));
    assert.deepEqual(after.approvals.filter((entry) => entry.sourceEntityId !== id), before.approvals.filter((entry) => entry.sourceEntityId !== id));
    assert.deepEqual(after.notifications.filter((entry) => entry.entityId !== id), before.notifications.filter((entry) => entry.entityId !== id));
    const targetApprovalIds = [...before.approvals, ...after.approvals].filter((entry) => entry.sourceEntityId === id).map((entry) => entry.id);
    const outside = (entry: State['audits'][number]) => entry.entityType === 'task' ? entry.entityId !== id : !targetApprovalIds.includes(entry.entityId);
    assert.deepEqual(after.audits.filter(outside), before.audits.filter(outside));
    assert.deepEqual(after.objects, before.objects);
    assert.deepEqual(after.attachments, before.attachments);
  };
  const history = (before: State, after: State, id: string, eventType: string, actorUserId = actorId) => {
    const previous = storedTask(before, id).historyEvents;
    const added = storedTask(after, id).historyEvents.filter((entry) => !previous.some((old) => old.id === entry.id));
    assert.ok(added.some((entry) => entry.eventType === eventType && entry.actorUserId === actorUserId), `Missing persisted ${eventType}`);
    assert.deepEqual(storedTask(after, id).historyEvents.filter((entry) => previous.some((old) => old.id === entry.id)), previous);
  };
  const complete = (id: string, login = 'manager2') => request(login, `/tasks/${id}/assignees/me/complete`, 'POST', { completionText: 'Actual assignee result' })
    .then((response) => json<TaskResponseDto>(response, 201));

  await t.test('create all is additive to active-user default; deny/revoke and module deny affect the existing cookie', async () => {
    const initial = await create({}, 'manager1');
    assert.equal(initial.createdBy.id, actorId);
    await rule('create', 'deny', 'all');
    await denied('', '', 'POST', input());
    await revoke('create');
    await rule('access', 'allow', 'all');
    await rule('create', 'allow', 'all');
    const before = await snapshot();
    const created = await create({}, 'manager1');
    const after = await snapshot();
    const stored = storedTask(after, created.id);
    assert.equal(after.tasks.length, before.tasks.length + 1);
    assert.equal(stored.createdByUserId, actorId);
    assert.equal(stored.status, 'in_progress');
    assert.equal(stored.assignees.length, 1);
    assert.equal(stored.assignees[0].userId, performerId);
    assert.equal(stored.assignees[0].isCompleted, false);
    assert.equal(stored.historyEvents.length, 1);
    assert.equal(stored.historyEvents[0].eventType, 'task.created');
    assert.equal(stored.historyEvents[0].actorUserId, actorId);
    assert.equal(after.notifications.filter((entry) => entry.entityId === created.id && entry.type === 'task.assigned' && entry.recipientUserId === performerId).length, 1);
    unrelated(before, after, created.id);
    await rule('access', 'deny', 'all');
    await denied('', '', 'POST', input());
    await reset();
    await create({}, 'manager1');
  });

  await t.test('read selected/all grants discover private A without control B; history requires its own leaf and never mutates state', async () => {
    await reset();
    const a = await create({ visibilityType: 'private', visibleUserIds: [] });
    const b = await create({ visibilityType: 'private', visibleUserIds: [] });
    await denied(a.id, '', 'GET', undefined, 404);
    await rule('access', 'allow', 'selected', [a.id]);
    await denied(a.id, '', 'GET', undefined, 404);
    await rule('read', 'allow', 'selected', [a.id]);
    const before = await snapshot();
    assert.equal((await card(a.id)).id, a.id);
    await denied(b.id, '', 'GET', undefined, 404);
    const list = await json<{ items: TaskResponseDto[]; total: number }>(await request('manager1', `/tasks?q=${encodeURIComponent(a.title)}&page=1&limit=1`), 200);
    assert.equal(list.total, 1);
    assert.equal(list.items[0].id, a.id);
    await denied(a.id, '/history', 'GET');
    await rule('history', 'allow', 'selected', [a.id]);
    const events = await json<Array<{ id: string; eventType: string }>>(await request('manager1', `/tasks/${a.id}/history`), 200);
    assert.deepEqual(events.map((event) => event.id), storedTask(before, a.id).historyEvents.map((event) => event.id));
    assert.equal(events[0].eventType, 'task.created');
    await rule('history', 'deny', 'selected', [a.id]);
    await denied(a.id, '/history', 'GET');
    await revoke('history');
    await denied(a.id, '/history', 'GET');
    await rule('read', 'deny', 'selected', [a.id]);
    await denied(a.id, '', 'GET', undefined, 404);
    await denied(a.id, '/history', 'GET', undefined, 404);
    await revoke('read');
    await denied(a.id, '', 'GET', undefined, 404);
    await rule('read', 'allow', 'all');
    await card(a.id);
    await card(b.id);
    await rule('history', 'allow', 'all');
    await json(await request('manager1', `/tasks/${b.id}/history`), 200);
    await rule('access', 'deny', 'selected', [a.id]);
    await denied(a.id, '', 'GET', undefined, 404);
    await denied(a.id, '/history', 'GET', undefined, 404);
    await card(b.id);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test('update and assignees.manage independently extend author authority for selected A, with revoke, control B and last-assignee protection', async () => {
    await reset();
    const a = await create();
    const b = await create();
    await denied(a.id, '', 'PATCH', { description: 'Default non-author denial' });
    await rule('update', 'allow', 'selected', [a.id]);
    let before = await snapshot();
    const changed = await json<TaskResponseDto>(await request('manager1', `/tasks/${a.id}`, 'PATCH', { description: 'Selected editor change' }), 200);
    let after = await snapshot();
    assert.equal(changed.description, 'Selected editor change');
    assert.equal(storedTask(after, a.id).description, changed.description);
    assert.equal(storedTask(after, a.id).createdByUserId, users.get('founder'));
    history(before, after, a.id, 'task.updated');
    unrelated(before, after, a.id);
    await denied(b.id, '', 'PATCH', { description: 'Control B denied' });
    await denied(a.id, '/assignees', 'POST', { userIds: [users.get('hr1')] });
    await rule('update', 'deny', 'selected', [a.id]);
    await denied(a.id, '', 'PATCH', { description: 'Explicit leaf deny' });
    await revoke('update');
    await denied(a.id, '', 'PATCH', { description: 'Revoked editor' });
    await rule('assignees.manage', 'allow', 'selected', [a.id]);
    before = await snapshot();
    await json(await request('manager1', `/tasks/${a.id}/assignees`, 'POST', { userIds: [users.get('hr1')] }), 201);
    after = await snapshot();
    const added = storedTask(after, a.id).assignees.find((entry) => entry.userId === users.get('hr1'))!;
    assert.ok(added.isActive);
    assert.equal(storedTask(after, a.id).assignees.length, 2);
    assert.deepEqual(storedTask(after, a.id).assignees.find((entry) => entry.userId === performerId), storedTask(before, a.id).assignees[0]);
    history(before, after, a.id, 'task.assignee_added');
    unrelated(before, after, a.id);
    await denied(b.id, '/assignees', 'POST', { userIds: [users.get('hr1')] });
    await rule('assignees.manage', 'deny', 'selected', [a.id]);
    await denied(a.id, `/assignees/${users.get('hr1')}`, 'DELETE');
    await revoke('assignees.manage');
    await denied(a.id, `/assignees/${users.get('hr1')}`, 'DELETE');
    await rule('assignees.manage', 'allow', 'selected', [a.id]);
    await rule('access', 'deny', 'selected', [a.id]);
    await denied(a.id, `/assignees/${users.get('hr1')}`, 'DELETE');
    await revoke('access');
    before = await snapshot();
    await json(await request('manager1', `/tasks/${a.id}/assignees/${users.get('hr1')}`, 'DELETE'), 200);
    after = await snapshot();
    const removed = storedTask(after, a.id).assignees.find((entry) => entry.id === added.id)!;
    assert.equal(removed.isActive, false);
    assert.equal(removed.removedByUserId, actorId);
    assert.ok(removed.removedAt);
    history(before, after, a.id, 'task.assignee_removed');
    unrelated(before, after, a.id);
    await denied(a.id, `/assignees/${performerId}`, 'DELETE', undefined, 409);
  });

  await t.test('object ancestor deny blocks task read and selected editing without moving the task out of its context', async () => {
    await reset();
    const object = await prisma.object.create({ data: {
      id: randomUUID(), name: `${marker}-parent`, address: 'Isolated task parent', status: 'active',
      createdByUserId: users.get('founder')!, assignments: { create: { userId: actorId, assignmentRoleCode: 'manager', isActive: true } },
    } });
    const target = await create({ objectId: object.id });
    await rule('update', 'allow', 'selected', [target.id]);
    await denied(target.id, '', 'PATCH', { objectId: null });
    await rule('read', 'deny', 'selected', [object.id], 'objects');
    await denied(target.id, '', 'GET', undefined, 404);
    await denied(target.id, '', 'PATCH', { description: 'Parent read denied' });
    await revoke('read', 'objects');
    const before = await snapshot();
    await json(await request('manager1', `/tasks/${target.id}`, 'PATCH', { description: 'Restored parent' }), 200);
    const after = await snapshot();
    assert.equal(storedTask(after, target.id).objectId, object.id);
    assert.equal(storedTask(after, target.id).description, 'Restored parent');
    history(before, after, target.id, 'task.updated');
    unrelated(before, after, target.id);
  });

  await t.test('draft/submit/undo obey own active assignment, required evidence and same-cookie denies without duplicate approval', async () => {
    await reset();
    const a = await create({ assigneeUserIds: [actorId] });
    const b = await create();
    assert.equal((await card(a.id)).capabilities.canCreateCompletionDraft, true);
    assert.equal((await card(b.id)).capabilities.canCreateCompletionDraft, false);
    await rule('completion.draft', 'allow', 'all');
    await denied(b.id, '/assignees/me/completion-draft');
    await rule('completion.draft', 'deny', 'selected', [a.id]);
    const deniedDraftCard = await card(a.id);
    assert.equal(deniedDraftCard.capabilities.canCreateCompletionDraft, false);
    assert.equal(deniedDraftCard.capabilities.canCompleteMyAssignment, true);
    await denied(a.id, '/assignees/me/completion-draft');
    await rule('completion.draft', 'allow', 'selected', [a.id]);
    assert.equal((await card(a.id)).capabilities.canCreateCompletionDraft, true);
    let before = await snapshot();
    const draft = await json<{ id: string; workCycle: number }>(await request('manager1', `/tasks/${a.id}/assignees/me/completion-draft`, 'POST'), 201);
    let after = await snapshot();
    const assignment = storedTask(after, a.id).assignees[0];
    assert.equal(assignment.userId, actorId);
    assert.equal(assignment.isCompleted, false);
    assert.equal(assignment.completions.length, 1);
    assert.equal(assignment.completions[0].id, draft.id);
    assert.equal(assignment.completions[0].status, 'draft');
    assert.equal(draft.workCycle, a.workCycle);
    unrelated(before, after, a.id);
    await revoke('completion.draft');
    const replay = await json<{ id: string }>(await request('manager1', `/tasks/${a.id}/assignees/me/completion-draft`, 'POST'), 201);
    assert.equal(replay.id, draft.id);
    assert.deepEqual(await snapshot(), after);
    await denied(a.id, '/assignees/me/complete', 'POST', { completionId: draft.id }, 400);
    await rule('completion.submit', 'deny', 'selected', [a.id]);
    await denied(a.id, '/assignees/me/complete', 'POST', { completionId: draft.id, completionText: 'Denied result' });
    await rule('completion.submit', 'allow', 'selected', [a.id]);
    before = await snapshot();
    const submitted = await json<TaskResponseDto>(await request('manager1', `/tasks/${a.id}/assignees/me/complete`, 'POST', {
      completionId: draft.id, completionText: 'Authorized own result',
    }), 201);
    after = await snapshot();
    assert.equal(submitted.status, 'awaiting_confirmation');
    assert.equal(submitted.capabilities.canCreateCompletionDraft, false);
    assert.equal(storedTask(after, a.id).assignees[0].isCompleted, true);
    assert.equal(storedTask(after, a.id).assignees[0].completions[0].status, 'submitted');
    assert.equal(storedTask(after, a.id).assignees[0].completions[0].completionText, 'Authorized own result');
    const pending = after.approvals.filter((entry) => entry.sourceEntityId === a.id && entry.status === 'pending');
    assert.equal(pending.length, 1);
    assert.equal(pending[0].createdByUserId, actorId);
    assert.equal(pending[0].approvalType, 'task_result_confirmation');
    assert.ok(after.audits.some((event) => event.entityId === pending[0].id && event.action === 'approval.request.created'));
    history(before, after, a.id, 'task.assignee_completed');
    unrelated(before, after, a.id);
    await denied(a.id, '/assignees/me/complete', 'POST', { completionText: 'Duplicate completion' }, 409);
    await rule('completion.undo', 'deny', 'selected', [a.id]);
    await denied(a.id, '/assignees/me/undo-completion');
    await rule('completion.undo', 'allow', 'selected', [a.id]);
    await rule('access', 'deny', 'selected', [a.id]);
    await denied(a.id, '/assignees/me/undo-completion');
    await revoke('access');
    before = await snapshot();
    await json(await request('manager1', `/tasks/${a.id}/assignees/me/undo-completion`, 'POST'), 201);
    after = await snapshot();
    assert.equal(storedTask(after, a.id).status, 'in_progress');
    assert.equal(storedTask(after, a.id).workCycle, a.workCycle);
    const undone = storedTask(after, a.id).assignees[0];
    assert.equal(undone.isCompleted, false);
    assert.equal(undone.completions[0].status, 'cancelled');
    assert.equal(undone.completions[0].cancelledByUserId, actorId);
    assert.equal(after.approvals.find((entry) => entry.id === pending[0].id)?.status, 'cancelled');
    history(before, after, a.id, 'task.assignee_completion_cancelled');
    unrelated(before, after, a.id);
    await revoke('completion.undo');
    await denied(a.id, '/assignees/me/undo-completion', 'POST', undefined, 409);
  });

  await t.test('draft deny does not block comment-only submission or submission of an existing draft', async () => {
    for (const withExistingDraft of [false, true]) {
      await reset();
      const target = await create({ assigneeUserIds: [actorId], completionRequirement: 'comment_required' });
      const draft = withExistingDraft
        ? await json<{ id: string }>(await request('manager1', `/tasks/${target.id}/assignees/me/completion-draft`, 'POST'), 201)
        : null;
      await rule('completion.draft', 'deny', 'selected', [target.id]);
      const current = await card(target.id);
      assert.equal(current.capabilities.canCreateCompletionDraft, false);
      assert.equal(current.capabilities.canCompleteMyAssignment, true);
      await denied(target.id, '/assignees/me/completion-draft');
      const submitted = await json<TaskResponseDto>(await request('manager1', `/tasks/${target.id}/assignees/me/complete`, 'POST', {
        ...(draft ? { completionId: draft.id } : {}), completionText: 'Independent comment-only result',
      }), 201);
      assert.equal(submitted.capabilities.canCreateCompletionDraft, false);
      const saved = await prisma.taskAssigneeCompletion.findMany({ where: { taskAssignee: { taskId: target.id, userId: actorId } } });
      assert.equal(saved.length, 1);
      assert.equal(saved[0].status, 'submitted');
      if (draft) assert.equal(saved[0].id, draft.id);
    }
  });

  await t.test('result.submit uses its real compatibility endpoint and still requires completion.submit plus active assignment', async () => {
    await reset();
    const target = await create({ assigneeUserIds: [actorId] });
    const control = await create();
    await rule('result.submit', 'allow', 'all');
    await denied(control.id, '/result', 'POST', { resultText: 'Grant cannot supply an assignment' });
    await rule('result.submit', 'deny', 'selected', [target.id]);
    await denied(target.id, '/result', 'POST', { resultText: 'Denied result endpoint' });
    await rule('result.submit', 'allow', 'selected', [target.id]);
    await rule('completion.submit', 'deny', 'selected', [target.id]);
    await denied(target.id, '/result', 'POST', { resultText: 'Completion leaf denied' });
    await revoke('completion.submit');
    const before = await snapshot();
    const result = await json<TaskResponseDto>(await request('manager1', `/tasks/${target.id}/result`, 'POST', { resultText: 'Compatibility result submission' }), 201);
    const after = await snapshot();
    assert.equal(result.status, 'awaiting_confirmation');
    assert.equal(storedTask(after, target.id).assignees[0].completions[0].completionText, 'Compatibility result submission');
    assert.equal(after.approvals.filter((entry) => entry.sourceEntityId === target.id && entry.status === 'pending').length, 1);
    history(before, after, target.id, 'task.assignee_completed');
    unrelated(before, after, target.id);
  });

  for (const operation of ['confirm', 'complete_now', 'return', 'reopen', 'cancel'] as const) {
    await t.test(`${operation} selected grant performs only its valid lifecycle transition, with control B and live revoke`, async () => {
      await reset();
      const endpoint = operation === 'complete_now' ? 'complete-now' : operation === 'return' ? 'return-to-work' : operation;
      const body = ['return', 'reopen', 'cancel'].includes(operation) ? { reason: `Authorized ${operation} reason` } : undefined;
      const prepare = async () => {
        const task = await create({ requiresConfirmation: operation !== 'complete_now' });
        await complete(task.id);
        if (operation === 'reopen') await json(await request('founder', `/tasks/${task.id}/confirm`, 'POST'), 201);
        return task;
      };
      const a = await prepare();
      const b = await prepare();
      await denied(a.id, `/${endpoint}`, 'POST', body);
      await rule(operation, 'allow', 'selected', [a.id]);
      await denied(b.id, `/${endpoint}`, 'POST', body);
      await rule(operation, 'deny', 'selected', [a.id]);
      await denied(a.id, `/${endpoint}`, 'POST', body);
      await revoke(operation);
      await denied(a.id, `/${endpoint}`, 'POST', body);
      await rule(operation, 'allow', 'selected', [a.id]);
      await rule('access', 'deny', 'selected', [a.id]);
      await denied(a.id, `/${endpoint}`, 'POST', body);
      await revoke('access');
      if (body) await denied(a.id, `/${endpoint}`, 'POST', { reason: '' }, 400);
      const before = await snapshot();
      const previous = storedTask(before, a.id);
      assert.notEqual(previous.createdByUserId, actorId);
      assert.ok(previous.assignees.every((entry) => entry.userId !== actorId));
      const result = await json<TaskResponseDto>(await request('manager1', `/tasks/${a.id}/${endpoint}`, 'POST', body), 201);
      const after = await snapshot();
      const saved = storedTask(after, a.id);
      const expectedStatus = ['confirm', 'complete_now'].includes(operation) ? 'completed'
        : operation === 'cancel' ? 'cancelled' : 'in_progress';
      assert.equal(saved.status, expectedStatus);
      assert.equal(result.status, expectedStatus);
      assert.equal(saved.autoCloseAt, null);
      assert.equal(saved.workCycle, previous.workCycle + (['return', 'reopen'].includes(operation) ? 1 : 0));
      const eventType = operation === 'confirm' ? 'task.confirmed' : operation === 'complete_now' ? 'task.completed_manually'
        : operation === 'return' ? 'task.returned_to_work' : operation === 'reopen' ? 'task.reopened' : 'task.cancelled';
      history(before, after, a.id, eventType);
      if (expectedStatus === 'completed') {
        assert.ok(saved.completedAt);
        assert.equal(saved.completedByUserId, actorId);
        assert.ok(saved.assignees.every((entry) => entry.isCompleted));
      } else if (operation === 'cancel') {
        assert.ok(saved.cancelledAt);
        assert.equal(saved.cancelledByUserId, actorId);
        assert.equal(saved.cancellationReason, body!.reason);
      } else {
        assert.ok(saved.assignees.every((entry) => !entry.isCompleted));
        assert.ok(saved.assignees.flatMap((entry) => entry.completions).every((entry) => entry.status === 'invalidated' && entry.cancelledByUserId === actorId));
      }
      const approvals = after.approvals.filter((entry) => entry.sourceEntityId === a.id);
      if (operation === 'complete_now') assert.deepEqual(approvals, []);
      else {
        assert.equal(approvals.length, 1);
        const approved = operation === 'confirm' || operation === 'reopen';
        assert.equal(approvals[0].status, approved ? 'approved' : 'cancelled');
        if (operation === 'confirm') assert.equal(approvals[0].resolvedByUserId, actorId);
        if (!approved) assert.equal(approvals[0].cancelledByUserId, actorId);
      }
      unrelated(before, after, a.id);
      if (operation === 'confirm' || operation === 'complete_now') await denied(a.id, `/${endpoint}`, 'POST', body, 409);
    });
  }

  await t.test('unsupported tasks.status cannot bypass dedicated lifecycle stages through the compatibility route', async () => {
    await reset();
    const task = await create();
    await denied(task.id, '/status', 'PATCH', { status: 'completed' });
    await denied(task.id, '/status', 'PATCH', { status: 'awaiting_confirmation' });
    const before = await snapshot();
    const noop = await json<TaskResponseDto>(await request('manager1', `/tasks/${task.id}/status`, 'PATCH', { status: 'in_progress' }), 200);
    assert.equal(noop.status, 'in_progress');
    assert.deepEqual(await snapshot(), before);
    await rule('confirm', 'allow', 'selected', [task.id]);
    await denied(task.id, '/confirm', 'POST', undefined, 409);
    await rule('complete_now', 'allow', 'selected', [task.id]);
    await denied(task.id, '/complete-now', 'POST', undefined, 409);
    await rule('reopen', 'allow', 'selected', [task.id]);
    await denied(task.id, '/reopen', 'POST', { reason: 'Cannot reopen unfinished task' }, 409);
    await reset();
    // The isolated runner owns and removes every fixture; this file never targets shared data.
  });
});
