import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface TaskPayload {
  id: string;
  status: string;
  workCycle: number;
  dueAt: string | null;
  dueTimeSpecified: boolean;
  completionProgress: { completed: number; total: number };
  assignees: Array<{
    id: string;
    isActive: boolean;
    isCompleted: boolean;
    completionHistoryCount: number;
    currentCompletion: {
      id: string;
      attachments: Array<{ id: string }>;
    } | null;
  }>;
}

async function getTaskPayload(
  baseUrl: string,
  cookie: string,
  taskId: string,
): Promise<TaskPayload> {
  const response = await fetch(`${baseUrl}/api/v1/tasks/${taskId}`, {
    headers: { Cookie: cookie },
  });
  assert.equal(response.status, 200);
  return response.json() as Promise<TaskPayload>;
}

test('task lifecycle keeps per-assignee results and one shared confirmation', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = randomUUID().slice(0, 8);
  const createdTaskIds: string[] = [];
  const [managerOne, managerTwo, hrUser] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { login: 'manager1' },
      select: { id: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { login: 'manager2' },
      select: { id: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { login: 'hr1' },
      select: { id: true },
    }),
  ]);
  const [founderCookie, managerOneCookie, managerTwoCookie] = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: 'founder',
      password: 'founder123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: 'manager1',
      password: 'manager123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: 'manager2',
      password: 'manager123',
    }),
  ]);

  t.after(async () => {
    const approvalIds = (
      await prisma.approvalRequest.findMany({
        where: {
          sourceEntityType: 'task',
          sourceEntityId: { in: createdTaskIds },
        },
        select: { id: true },
      })
    ).map((item) => item.id);
    await prisma.auditEvent.deleteMany({
      where: { entityType: 'approval_request', entityId: { in: approvalIds } },
    });
    await prisma.approvalRequest.deleteMany({ where: { id: { in: approvalIds } } });
    await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
    await app.close();
    await prisma.$disconnect();
  });

  const createResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: 'POST',
    headers: {
      Cookie: managerOneCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `Lifecycle task ${marker}`,
      description: 'Two assignees complete independently',
      priority: 'important_not_urgent',
      assigneeUserIds: [managerOne.id, managerTwo.id],
      visibilityMode: 'selected',
      requiresConfirmation: true,
      completionRequirement: 'comment_required',
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()) as TaskPayload;
  createdTaskIds.push(created.id);
  assert.equal(created.status, 'in_progress');
  assert.deepEqual(created.completionProgress, { completed: 0, total: 2 });

  const complete = async (cookie: string, text: string) => {
    const response = await fetch(
      `${baseUrl}/api/v1/tasks/${created.id}/assignees/me/complete`,
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ completionText: text }),
      },
    );
    return {
      response,
      payload: (await response.json()) as TaskPayload,
    };
  };

  const firstCompletion = await complete(
    managerTwoCookie,
    'Manager two completed own part',
  );
  assert.equal(firstCompletion.response.status, 201);
  assert.equal(firstCompletion.payload.status, 'in_progress');
  assert.deepEqual(firstCompletion.payload.completionProgress, {
    completed: 1,
    total: 2,
  });

  const duplicateCompletion = await complete(
    managerTwoCookie,
    'Duplicate completion',
  );
  assert.equal(duplicateCompletion.response.status, 409);

  const secondCompletion = await complete(
    managerOneCookie,
    'Creator completed own part',
  );
  assert.equal(secondCompletion.response.status, 201);
  assert.equal(secondCompletion.payload.status, 'awaiting_confirmation');
  assert.deepEqual(secondCompletion.payload.completionProgress, {
    completed: 2,
    total: 2,
  });

  const approvalsResponse = await fetch(
    `${baseUrl}/api/v1/approvals?sourceEntityType=task&sourceEntityId=${created.id}&status=pending`,
    { headers: { Cookie: founderCookie } },
  );
  const approvals = (await approvalsResponse.json()) as Array<{ id: string }>;
  assert.equal(approvals.length, 1);

  const rejectResponse = await fetch(
    `${baseUrl}/api/v1/approvals/${approvals[0]?.id}/reject`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'Нужно доработать результат' }),
    },
  );
  assert.equal(rejectResponse.status, 200);

  const afterRejectResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${created.id}`,
    { headers: { Cookie: managerOneCookie } },
  );
  const afterReject = (await afterRejectResponse.json()) as TaskPayload;
  assert.equal(afterReject.status, 'in_progress');
  assert.equal(afterReject.workCycle, 2);
  assert.deepEqual(afterReject.completionProgress, { completed: 0, total: 2 });

  await complete(managerTwoCookie, 'Cycle two manager two result');
  const cycleTwoFinal = await complete(
    managerOneCookie,
    'Cycle two creator result',
  );
  assert.equal(cycleTwoFinal.payload.status, 'awaiting_confirmation');

  const confirmResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${created.id}/confirm`,
    { method: 'POST', headers: { Cookie: managerOneCookie } },
  );
  assert.equal(confirmResponse.status, 201);
  const confirmed = (await confirmResponse.json()) as TaskPayload;
  assert.equal(confirmed.status, 'completed');

  const leadershipEdit = await fetch(`${baseUrl}/api/v1/tasks/${created.id}`, {
    method: 'PATCH',
    headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: 'Leadership must not rewrite body' }),
  });
  assert.equal(leadershipEdit.status, 403);

  const reopenResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${created.id}/reopen`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Требуется новый цикл работ' }),
    },
  );
  assert.equal(reopenResponse.status, 201);
  const reopened = (await reopenResponse.json()) as TaskPayload;
  assert.equal(reopened.status, 'in_progress');
  assert.equal(reopened.workCycle, 3);

  await complete(managerTwoCookie, 'Completion before creator edit');
  const unsafeUpdate = await fetch(`${baseUrl}/api/v1/tasks/${created.id}`, {
    method: 'PATCH',
    headers: { Cookie: managerOneCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: 'Significant update' }),
  });
  assert.equal(unsafeUpdate.status, 409);

  const safeUpdate = await fetch(`${baseUrl}/api/v1/tasks/${created.id}`, {
    method: 'PATCH',
    headers: { Cookie: managerOneCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      description: 'Significant update',
      resetCompletions: true,
    }),
  });
  assert.equal(safeUpdate.status, 200);
  const updated = (await safeUpdate.json()) as TaskPayload;
  assert.equal(updated.workCycle, 4);
  assert.deepEqual(updated.completionProgress, { completed: 0, total: 2 });
  assert.ok(
    updated.assignees.some(
      (assignee) =>
        assignee.id === managerTwo.id && assignee.completionHistoryCount >= 3,
    ),
  );

  const addAssigneeResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${created.id}/assignees`,
    {
      method: 'POST',
      headers: { Cookie: managerOneCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: [hrUser.id] }),
    },
  );
  assert.equal(addAssigneeResponse.status, 201);

  const removeManagerTwo = await fetch(
    `${baseUrl}/api/v1/tasks/${created.id}/assignees/${managerTwo.id}`,
    { method: 'DELETE', headers: { Cookie: managerOneCookie } },
  );
  assert.equal(removeManagerTwo.status, 200);
  const removeCreator = await fetch(
    `${baseUrl}/api/v1/tasks/${created.id}/assignees/${managerOne.id}`,
    { method: 'DELETE', headers: { Cookie: managerOneCookie } },
  );
  assert.equal(removeCreator.status, 200);
  const removeLast = await fetch(
    `${baseUrl}/api/v1/tasks/${created.id}/assignees/${hrUser.id}`,
    { method: 'DELETE', headers: { Cookie: managerOneCookie } },
  );
  assert.equal(removeLast.status, 409);

  const cancelResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${created.id}/cancel`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Работы больше не требуются' }),
    },
  );
  assert.equal(cancelResponse.status, 201);
  assert.equal(((await cancelResponse.json()) as TaskPayload).status, 'cancelled');

  const historyResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${created.id}/history`,
    { headers: { Cookie: managerOneCookie } },
  );
  assert.equal(historyResponse.status, 200);
  const history = (await historyResponse.json()) as Array<{ eventType: string }>;
  assert.ok(history.some((event) => event.eventType === 'task.assignee_completed'));
  assert.ok(history.some((event) => event.eventType === 'task.reopened'));
  assert.ok(history.some((event) => event.eventType === 'task.cancelled'));

  const concurrentCreate = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: 'POST',
    headers: {
      Cookie: managerOneCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `Concurrent completion ${marker}`,
      priority: 'important_not_urgent',
      assigneeUserIds: [managerOne.id],
      visibilityMode: 'selected',
      completionRequirement: 'comment_required',
    }),
  });
  const concurrentTask = (await concurrentCreate.json()) as TaskPayload;
  createdTaskIds.push(concurrentTask.id);
  const concurrentComplete = () =>
    fetch(
      `${baseUrl}/api/v1/tasks/${concurrentTask.id}/assignees/me/complete`,
      {
        method: 'POST',
        headers: {
          Cookie: managerOneCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ completionText: 'Single accepted result' }),
      },
    );
  const concurrentStatuses = (
    await Promise.all([concurrentComplete(), concurrentComplete()])
  )
    .map((response) => response.status)
    .sort();
  assert.deepEqual(concurrentStatuses, [201, 409]);
  assert.equal(
    await prisma.taskAssigneeCompletion.count({
      where: {
        taskAssignee: { taskId: concurrentTask.id },
        status: 'submitted',
      },
    }),
    1,
  );
});

test('task deadlines, dual targets and completion file requirements are enforced', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = randomUUID().slice(0, 8);
  const createdTaskIds: string[] = [];
  const createdFileIds: string[] = [];
  const [founder, manager] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { login: 'founder' },
      select: { id: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { login: 'manager1' },
      select: { id: true },
    }),
  ]);
  const object = await prisma.object.create({
    data: {
      name: `Task dual target ${marker}`,
      internalName: `DUAL-${marker}`,
      address: `Москва, dual ${marker}`,
      status: 'active',
      dailyRate: 0,
      createdByUserId: founder.id,
      assignments: {
        create: {
          userId: manager.id,
          assignmentRoleCode: 'manager',
          isActive: true,
        },
      },
    },
  });
  const order = await prisma.oneTimeOrder.create({
    data: {
      title: `Task order ${marker}`,
      executionAddress: 'Москва',
      status: 'planned',
      contactName: 'Test contact',
      createdByUserId: founder.id,
      assignments: {
        create: {
          userId: manager.id,
          assignmentRoleCode: 'one_time_manager',
          isActive: true,
        },
      },
    },
  });
  const managerCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'manager1',
    password: 'manager123',
  });

  t.after(async () => {
    await prisma.fileAttachment.deleteMany({
      where: { fileId: { in: createdFileIds } },
    });
    await prisma.file.deleteMany({ where: { id: { in: createdFileIds } } });
    await prisma.approvalRequest.deleteMany({
      where: { sourceEntityType: 'task', sourceEntityId: { in: createdTaskIds } },
    });
    await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
    await prisma.oneTimeOrder.delete({ where: { id: order.id } });
    await prisma.object.delete({ where: { id: object.id } });
    await app.close();
    await prisma.$disconnect();
  });

  const createResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: 'POST',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `File task ${marker}`,
      priority: 'important_not_urgent',
      objectId: object.id,
      oneTimeOrderId: order.id,
      assigneeUserIds: [manager.id],
      visibilityMode: 'scope',
      requiresConfirmation: false,
      completionRequirement: 'file_required',
      dueDate: '2030-01-15',
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()) as TaskPayload;
  createdTaskIds.push(created.id);
  assert.equal(created.dueAt, '2030-01-15T20:59:59.000Z');
  assert.equal(created.dueTimeSpecified, false);

  const draftResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${created.id}/assignees/me/completion-draft`,
    { method: 'POST', headers: { Cookie: managerCookie } },
  );
  assert.equal(draftResponse.status, 201);
  const draft = (await draftResponse.json()) as { id: string };

  const missingFileResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${created.id}/assignees/me/complete`,
    {
      method: 'POST',
      headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ completionId: draft.id }),
    },
  );
  assert.equal(missingFileResponse.status, 400);

  const file = await prisma.file.create({
    data: {
      bucket: 'integration-test',
      objectKey: `task-completion/${marker}.txt`,
      originalName: 'result.txt',
      mimeType: 'text/plain',
      sizeBytes: 6,
      uploadedByUserId: manager.id,
      attachments: {
        create: {
          entityType: 'task_assignee_completion',
          entityId: draft.id,
          uploadedByUserId: manager.id,
        },
      },
    },
  });
  createdFileIds.push(file.id);

  const completeResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${created.id}/assignees/me/complete`,
    {
      method: 'POST',
      headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ completionId: draft.id }),
    },
  );
  assert.equal(completeResponse.status, 201);
  assert.equal(
    ((await completeResponse.json()) as TaskPayload).status,
    'pending_auto_close',
  );
  const completedWithFile = await getTaskPayload(
    baseUrl,
    managerCookie,
    created.id,
  );
  assert.equal(completedWithFile.assignees[0]?.currentCompletion?.attachments.length, 1);

  const undoResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${created.id}/assignees/me/undo-completion`,
    { method: 'POST', headers: { Cookie: managerCookie } },
  );
  assert.equal(undoResponse.status, 201);
  const undone = (await undoResponse.json()) as TaskPayload;
  assert.equal(undone.status, 'in_progress');

  const newDraftResponse = await fetch(
    `${baseUrl}/api/v1/tasks/${created.id}/assignees/me/completion-draft`,
    { method: 'POST', headers: { Cookie: managerCookie } },
  );
  const newDraft = (await newDraftResponse.json()) as { id: string };
  assert.notEqual(newDraft.id, draft.id);
  const oldFileDoesNotCount = await fetch(
    `${baseUrl}/api/v1/tasks/${created.id}/assignees/me/complete`,
    {
      method: 'POST',
      headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ completionId: newDraft.id }),
    },
  );
  assert.equal(oldFileDoesNotCount.status, 400);

  const clearRequirement = await fetch(`${baseUrl}/api/v1/tasks/${created.id}`, {
    method: 'PATCH',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ completionRequirement: 'none' }),
  });
  assert.equal(clearRequirement.status, 200);
  const finishWithoutReport = await fetch(
    `${baseUrl}/api/v1/tasks/${created.id}/assignees/me/complete`,
    {
      method: 'POST',
      headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ completionId: newDraft.id }),
    },
  );
  assert.equal(finishWithoutReport.status, 201);
  assert.equal(
    ((await finishWithoutReport.json()) as TaskPayload).status,
    'pending_auto_close',
  );

  const completeNow = await fetch(
    `${baseUrl}/api/v1/tasks/${created.id}/complete-now`,
    { method: 'POST', headers: { Cookie: managerCookie } },
  );
  assert.equal(completeNow.status, 201);
  assert.equal(((await completeNow.json()) as TaskPayload).status, 'completed');

  const noDeadlineResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: 'POST',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `No deadline ${marker}`,
      priority: 'important_not_urgent',
      assigneeUserIds: [manager.id],
      visibilityMode: 'selected',
    }),
  });
  assert.equal(noDeadlineResponse.status, 201);
  const noDeadline = (await noDeadlineResponse.json()) as TaskPayload;
  createdTaskIds.push(noDeadline.id);
  assert.equal(noDeadline.dueAt, null);

  await prisma.task.update({
    where: { id: noDeadline.id },
    data: { status: 'closed' },
  });
  assert.equal(
    (await getTaskPayload(baseUrl, managerCookie, noDeadline.id)).status,
    'completed',
  );

  const exactTimeResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: 'POST',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `Exact deadline ${marker}`,
      priority: 'important_not_urgent',
      assigneeUserIds: [manager.id],
      visibilityMode: 'selected',
      dueDate: '2030-01-15',
      dueTime: '12:30',
    }),
  });
  assert.equal(exactTimeResponse.status, 201);
  const exactTime = (await exactTimeResponse.json()) as TaskPayload;
  createdTaskIds.push(exactTime.id);
  assert.equal(exactTime.dueAt, '2030-01-15T09:30:00.000Z');
  assert.equal(exactTime.dueTimeSpecified, true);

  const invalidTimeOnly = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: 'POST',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `Invalid deadline ${marker}`,
      priority: 'important_not_urgent',
      assigneeUserIds: [manager.id],
      visibilityMode: 'selected',
      dueTime: '12:30',
    }),
  });
  assert.equal(invalidTimeOnly.status, 400);
});
