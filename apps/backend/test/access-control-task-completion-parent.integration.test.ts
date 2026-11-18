import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { SafeFileResponseDto } from '../src/modules/files/dto/safe-file-response.dto';
import type { TaskCompletionListResponseDto } from '../src/modules/tasks/dto/task-completion-response.dto';
import type { TaskResponseDto } from '../src/modules/tasks/dto/task-response.dto';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

type TargetKind = 'object' | 'order';
type Operation = 'result' | 'draft' | 'submit';
type TaskFixture = { id: string; parentId: string; kind: TargetKind };
type Draft = { id: string; workCycle: number };
type Gate = { code: string; id: string };

test('completion endpoints and nested file metadata honor fresh task/parent denies without side effects', { timeout: 180_000 }, async (t) => {
  // Reject shared/remote databases before creating any client or application.
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname));
  const schema = databaseUrl.searchParams.get('schema') ?? '';
  assert.match(schema, /^integration_\d+_\d+$/);
  // App startup may probe storage/cache; this metadata-only fixture never
  // uploads, downloads, previews, publishes jobs, or deletes binary objects.
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.MINIO_ENDPOINT ?? '127.0.0.1'));
  if (process.env.REDIS_HOST) assert.ok(['localhost', '127.0.0.1', '::1'].includes(process.env.REDIS_HOST));
  if (process.env.REDIS_URL) assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.REDIS_URL).hostname));

  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => { try { await closeApp?.(); } finally { await prisma.$disconnect(); } });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const founder = await prisma.user.findUniqueOrThrow({ where: { login: 'founder' } });
  const actor = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const other = await prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } });
  const actorCookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const authorCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id } }), 0);
  const marker = `acl-completion-parent-${randomUUID()}`;
  const objectIds: string[] = [];
  const orderIds: string[] = [];
  const taskIds: string[] = [];
  let sequence = 0;

  const request = (path: string, method = 'GET', body?: unknown, cookie = actorCookie) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
  });
  const json = async <T,>(response: Response, expected: number): Promise<T> => {
    const text = await response.text();
    assert.equal(response.status, expected, text);
    return JSON.parse(text) as T;
  };
  const rule = (code: string, effect: 'allow' | 'deny', scope: 'assigned' | 'selected' | 'all', selectedIds: string[] = []) => {
    const definition = ACCESS_ACTION_CATALOG.find((entry) => entry.code === code)!;
    assert.equal(definition.manageable, true, code);
    assert.ok(definition.allowedScopes.includes(scope), `${code}: ${scope}`);
    return prisma.userAccessRule.upsert({
      where: { userId_actionCode: { userId: actor.id, actionCode: code } },
      create: { userId: actor.id, actionCode: code, effect, scope, selectedIds }, update: { effect, scope, selectedIds },
    });
  };
  const reset = () => prisma.userAccessRule.deleteMany({ where: { userId: actor.id } });
  const create = async (kind: TargetKind, assigneeId = actor.id): Promise<TaskFixture> => {
    const label = `${marker}-${++sequence}`;
    let parentId: string;
    if (kind === 'object') {
      const object = await prisma.object.create({ data: {
        name: label, address: 'Loopback completion parent fixture', status: 'active', createdByUserId: founder.id,
        assignments: { create: { userId: actor.id, assignmentRoleCode: 'manager', isActive: true } },
      } });
      parentId = object.id;
      objectIds.push(object.id);
    } else {
      const order = await prisma.oneTimeOrder.create({ data: {
        title: label, executionAddress: 'Loopback completion parent fixture', contactName: 'Fixture',
        status: 'in_progress', createdByUserId: founder.id,
        assignments: { create: { userId: actor.id, assignmentRoleCode: 'one_time_manager', isActive: true } },
      } });
      parentId = order.id;
      orderIds.push(order.id);
    }
    const created = await json<TaskResponseDto>(await request('/tasks', 'POST', {
      title: label, priority: 'important_not_urgent',
      ...(kind === 'object' ? { objectId: parentId } : { oneTimeOrderId: parentId }),
      assigneeUserIds: [assigneeId], visibilityType: 'selected_users', visibleUserIds: [actor.id],
      requiresConfirmation: true, completionRequirement: 'comment_required', dueDate: '2040-01-15',
    }, authorCookie), 201);
    taskIds.push(created.id);
    assert.equal(created.createdBy.id, founder.id);
    assert.equal(created.workCycle, 1);
    assert.equal(created.status, 'in_progress');
    return { id: created.id, parentId, kind };
  };
  const card = (task: TaskFixture) => request(`/tasks/${task.id}`).then((response) => json<TaskResponseDto>(response, 200));
  const draft = (task: TaskFixture) => request(`/tasks/${task.id}/assignees/me/completion-draft`, 'POST').then((response) => json<Draft>(response, 201));
  const invoke = (task: TaskFixture, operation: Operation, completionId?: string) => operation === 'result'
    ? request(`/tasks/${task.id}/result`, 'POST', { resultText: 'Actual assigned recipient result' })
    : operation === 'draft'
      ? request(`/tasks/${task.id}/assignees/me/completion-draft`, 'POST')
      : request(`/tasks/${task.id}/assignees/me/complete`, 'POST', { completionId, completionText: 'Actual assigned recipient result' });
  const memberships = async () => ({
    actor: await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: {
      id: true, login: true, isActive: true, roles: { select: { roleId: true }, orderBy: { roleId: 'asc' } },
      permissions: { select: { permissionId: true }, orderBy: { permissionId: 'asc' } },
    } }),
    taskAssignments: await prisma.taskAssignee.findMany({ where: { taskId: { in: taskIds } }, orderBy: { id: 'asc' } }),
    taskVisibility: await prisma.taskVisibilityUser.findMany({ where: { taskId: { in: taskIds } }, orderBy: { id: 'asc' } }),
    objectAssignments: await prisma.objectAssignment.findMany({ where: { objectId: { in: objectIds } }, orderBy: { id: 'asc' } }),
    orderAssignments: await prisma.oneTimeOrderAssignment.findMany({ where: { oneTimeOrderId: { in: orderIds } }, orderBy: { id: 'asc' } }),
  });
  const snapshot = async () => ({
    memberships: await memberships(),
    tasks: await prisma.task.findMany({ where: { id: { in: taskIds } }, include: {
      assignees: { orderBy: { id: 'asc' }, include: { completions: { orderBy: { id: 'asc' } } } },
      historyEvents: { orderBy: { id: 'asc' } },
    }, orderBy: { id: 'asc' } }),
    objects: await prisma.object.findMany({ where: { id: { in: objectIds } }, orderBy: { id: 'asc' } }),
    orders: await prisma.oneTimeOrder.findMany({ where: { id: { in: orderIds } }, orderBy: { id: 'asc' } }),
    approvals: await prisma.approvalRequest.findMany({ where: { sourceEntityType: 'task' }, orderBy: { id: 'asc' } }),
    audits: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    // Publication timestamps can change asynchronously; identities must not.
    outbox: await prisma.notificationOutbox.findMany({ select: { id: true, notificationId: true, recipientUserId: true }, orderBy: { id: 'asc' } }),
    files: await prisma.file.findMany({ orderBy: { id: 'asc' } }),
    attachments: await prisma.fileAttachment.findMany({ orderBy: { id: 'asc' } }),
    derivatives: await prisma.fileDerivative.findMany({ orderBy: { id: 'asc' } }),
    payments: await prisma.oneTimeOrderCompletionPayment.findMany({ orderBy: { id: 'asc' } }),
    funding: await prisma.accountabilityFunding.findMany({ orderBy: { id: 'asc' } }),
    expenses: await prisma.accountabilityExpense.findMany({ orderBy: { id: 'asc' } }),
    closures: await prisma.accountabilityClosure.findMany({ orderBy: { id: 'asc' } }),
    accounts: await prisma.accountabilityAccount.findMany({ orderBy: { id: 'asc' } }),
    stock: await prisma.inventoryItem.findMany({ orderBy: { id: 'asc' } }),
    movements: await prisma.inventoryMovement.findMany({ orderBy: { id: 'asc' } }),
  });
  const denied = async (operation: () => Promise<Response>, status: number) => {
    const before = await snapshot();
    const response = await operation();
    const text = await response.text();
    const after = await snapshot();
    assert.deepEqual(after, before, 'Denied/read request must not mutate task, memberships, history, approval, notifications/outbox, files, money or stock');
    // Exact authorization failure, never a swallowed 404 after a committed write.
    assert.equal(response.status, status, text);
    return text;
  };
  const grantFlow = async (operation: Operation, scope: 'assigned' | 'all' = 'assigned') => {
    const before = await memberships();
    await rule('tasks.read', 'allow', 'assigned');
    await rule('tasks.history', 'allow', 'assigned');
    await rule(operation === 'draft' ? 'tasks.completion.draft' : 'tasks.completion.submit', 'allow', scope);
    if (operation === 'result') await rule('tasks.result.submit', 'allow', scope);
    assert.deepEqual(await memberships(), before, 'A personal scope rule is not an assignment, ownership, role or membership mutation');
  };
  const gates = (task: TaskFixture): Gate[] => [
    { code: 'tasks.access', id: task.id }, { code: 'tasks.read', id: task.id },
    { code: task.kind === 'object' ? 'objects.access' : 'one_time_orders.access', id: task.parentId },
    { code: task.kind === 'object' ? 'objects.read' : 'one_time_orders.read', id: task.parentId },
  ];
  const submitted = async (task: TaskFixture, response: Response) => {
    const body = await json<TaskResponseDto>(response, 201);
    assert.equal(body.id, task.id);
    assert.equal(body.status, 'awaiting_confirmation');
    assert.equal(body.workCycle, 1);
    assert.equal(body.createdBy.id, founder.id);
    assert.equal(body.myAssignment?.isCompleted, true);
    const saved = await prisma.task.findUniqueOrThrow({ where: { id: task.id }, include: {
      assignees: { include: { completions: true } }, historyEvents: true,
    } });
    assert.equal(saved.status, 'awaiting_confirmation');
    assert.equal(saved.assignees.length, 1);
    assert.equal(saved.assignees[0].userId, actor.id);
    assert.equal(saved.assignees[0].isCompleted, true);
    assert.equal(saved.assignees[0].completions.filter((row) => row.status === 'submitted').length, 1);
    assert.equal(saved.historyEvents.filter((row) => row.eventType === 'task.assignee_completed' && row.actorUserId === actor.id).length, 1);
    assert.equal(await prisma.approvalRequest.count({ where: { sourceEntityType: 'task', sourceEntityId: task.id, status: 'pending' } }), 1);
    return body;
  };

  for (const kind of ['object', 'order'] as const) {
    for (const operation of ['result', 'draft', 'submit'] as const) {
      const gateCodes = ['tasks.access', 'tasks.read', ...(kind === 'object' ? ['objects.access', 'objects.read'] : ['one_time_orders.access', 'one_time_orders.read'])];
      for (const gateCode of gateCodes) {
        await t.test(`${kind}/${operation}: ${gateCode} denies opened A despite assigned leaf allow; B and explicit regrant work`, async () => {
          await reset();
          const a = await create(kind), b = await create(kind);
          await grantFlow(operation);
          // Open with the recipient's original cookie before the rule changes.
          assert.equal((await card(a)).myAssignment?.isCompleted, false);
          assert.equal((await card(b)).myAssignment?.isCompleted, false);
          const draftA = operation === 'result' ? null : await draft(a);
          const draftB = operation === 'result' ? null : await draft(b);
          const gate = gates(a).find((entry) => entry.code === gateCode)!;
          const beforeGrant = await memberships();
          await rule(gate.code, 'deny', 'selected', [gate.id]);
          assert.deepEqual(await memberships(), beforeGrant);
          await denied(() => invoke(a, operation, draftA?.id), 403);
          const hidden = await denied(() => request(`/tasks/${a.id}`), 404);
          // The shared HTTP envelope repeats the caller's own URL, not task data.
          // Require the exact generic denial apart from that path and timestamp.
          const { path, timestamp, ...denial } = JSON.parse(hidden);
          assert.equal(path, `/api/v1/tasks/${a.id}`);
          assert.equal(typeof timestamp, 'string');
          assert.deepEqual(denial, {
            statusCode: 404,
            method: 'GET',
            error: { message: 'Task not found', error: 'Not Found', statusCode: 404 },
          });
          if (operation === 'draft') {
            assert.equal((await json<Draft>(await invoke(b, operation), 201)).id, draftB!.id);
          } else {
            await submitted(b, await invoke(b, operation, draftB?.id));
          }
          await denied(() => invoke(a, operation, draftA?.id), 403);
          await rule(gate.code, 'allow', 'selected', [gate.id]);
          assert.equal((await card(a)).myAssignment?.isCompleted, false);
          if (operation === 'draft') {
            const beforeReplay = await snapshot();
            assert.equal((await json<Draft>(await invoke(a, operation), 201)).id, draftA!.id);
            assert.deepEqual(await snapshot(), beforeReplay, 'Regrant reuses the retained draft without new events');
          } else {
            await submitted(a, await invoke(a, operation, draftA?.id));
          }
        });
      }

      await t.test(`${kind}/${operation}: assigned rule does not manufacture assignment; all rule still cannot bypass domain assignment`, async () => {
        await reset();
        const unassigned = await create(kind, other.id);
        await grantFlow(operation, 'assigned');
        assert.equal((await card(unassigned)).myAssignment, null, 'Explicit visibility/parent membership is not a task assignee');
        await denied(() => invoke(unassigned, operation), 403);
        await grantFlow(operation, 'all');
        await denied(() => invoke(unassigned, operation), 403);
        assert.equal(await prisma.taskAssignee.count({ where: { taskId: unassigned.id, userId: actor.id } }), 0);
      });
    }
  }

  for (const kind of ['object', 'order'] as const) {
    await t.test(`${kind}: completion file metadata honors selected file root/read and task/parent root/read after opening`, async (suite) => {
      await reset();
      const a = await create(kind), b = await create(kind);
      await grantFlow('submit');
      await rule('files.read', 'allow', 'all');
      const makeCompletion = async (task: TaskFixture) => {
        const completion = await draft(task);
        const file = await prisma.file.create({ data: {
          id: randomUUID(), bucket: `metadata-only-${schema}`, objectKey: `${marker}/${completion.id}.txt`,
          originalName: `${marker}-${completion.id}-private.txt`, mimeType: 'text/plain', sizeBytes: 7,
          uploadedByUserId: founder.id,
          attachments: { create: { entityType: 'task_assignee_completion', entityId: completion.id, uploadedByUserId: founder.id } },
        } });
        // No binary exists; only metadata endpoints below may be called.
        await submitted(task, await invoke(task, 'submit', completion.id));
        return { completion, file };
      };
      const ca = await makeCompletion(a), cb = await makeCompletion(b);
      const history = (task: TaskFixture) => request(`/tasks/${task.id}/completions?page=1&limit=1`).then((response) => json<TaskCompletionListResponseDto>(response, 200));
      const checkNested = async (task: TaskFixture, entry: typeof ca, visible: boolean) => {
        const before = await snapshot();
        const detail = await card(task);
        const results = await history(task);
        assert.equal(results.total, 1);
        assert.equal(results.items[0].id, entry.completion.id);
        assert.equal(results.items[0].completionText, 'Actual assigned recipient result');
        const arrays = [
          detail.assignees.find((row) => row.id === actor.id)!.currentCompletion!.attachments,
          detail.myAssignment!.currentCompletion!.attachments,
          results.items[0].attachments,
        ];
        for (const attachments of arrays) {
          assert.deepEqual(attachments.map((row) => row.id), visible ? [entry.file.id] : [], 'Nested metadata follows the same file policy as direct metadata');
          if (visible) assert.deepEqual(Object.keys(attachments[0]).sort(), ['createdAt', 'downloadUrl', 'id', 'mimeType', 'originalName', 'sizeBytes', 'viewUrl']);
        }
        const serialized = JSON.stringify({ detail, results });
        assert.equal(serialized.includes(entry.file.objectKey), false);
        assert.equal(serialized.includes(entry.file.bucket), false);
        if (!visible) for (const secret of [entry.file.id, entry.file.originalName, `/files/${entry.file.id}`]) assert.equal(serialized.includes(secret), false, 'No hidden ID, filename or href in either nested DTO');
        assert.deepEqual(await snapshot(), before, 'Reading/redacting metadata cannot change completion state or financial/event records');
      };
      await suite.test('tasks.history selected deny hides paginated old results while A read and control B remain allowed', async () => {
        await checkNested(a, ca, true);
        await checkNested(b, cb, true);
        const before = await snapshot();
        await rule('tasks.history', 'deny', 'selected', [a.id]);
        try {
          assert.equal((await card(a)).id, a.id, 'History denial is not a task.read denial');
          for (const page of [1, 2]) {
            const text = await denied(() => request(`/tasks/${a.id}/completions?page=${page}&limit=1`), 403);
            for (const secret of [ca.completion.id, ca.file.id, ca.file.originalName, 'Actual assigned recipient result']) assert.equal(text.includes(secret), false);
          }
          const control = await history(b);
          assert.equal(control.total, 1);
          assert.equal(control.items[0].id, cb.completion.id);
          assert.deepEqual(await snapshot(), before, 'History deny/replay/read creates no domain, money or event effects');
        } finally {
          await rule('tasks.history', 'allow', 'selected', [a.id]);
        }
        await checkNested(a, ca, true);
        await checkNested(b, cb, true);
      });
      const metadataGates = [...gates(a), { code: 'files.access', id: ca.file.id }, { code: 'files.read', id: ca.file.id }];
      for (const gate of metadataGates) {
        await suite.test(gate.code, async () => {
          await checkNested(a, ca, true);
          await checkNested(b, cb, true);
          const direct = await json<SafeFileResponseDto>(await request(`/files/${ca.file.id}`), 200);
          assert.equal(direct.id, ca.file.id);
          await rule(gate.code, 'deny', 'selected', [gate.id]);
          if (gate.code.startsWith('files.')) {
            await denied(() => request(`/files/${ca.file.id}`), 403);
            assert.deepEqual(await json<SafeFileResponseDto[]>(await request(`/files/entity/task_assignee_completion/${ca.completion.id}`), 200), []);
            // This must stay strict even if current task DTO mapping leaks.
            await checkNested(a, ca, false);
          } else {
            for (const path of [`/tasks/${a.id}`, `/tasks/${a.id}/completions?page=1&limit=1`]) {
              const text = await denied(() => request(path), 404);
              for (const secret of [ca.file.id, ca.file.originalName, ca.file.objectKey]) assert.equal(text.includes(secret), false);
            }
            await denied(() => request(`/files/${ca.file.id}`), 403);
          }
          await checkNested(b, cb, true);
          await rule(gate.code, 'allow', 'selected', [gate.id]);
          await checkNested(a, ca, true);
          assert.equal((await json<SafeFileResponseDto>(await request(`/files/${ca.file.id}`), 200)).id, ca.file.id);
        });
      }
    });
  }
  await reset();
  // The isolated runner owns schema teardown. No broad cleanup or binary I/O.
});
