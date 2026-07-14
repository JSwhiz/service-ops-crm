import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('task visibility is access-safe for leadership, assignments and explicit users', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = randomUUID().slice(0, 8);
  const createdTaskIds: string[] = [];

  const [founder, managerOne, managerTwo, hrUser, deputyDirector] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { login: 'founder' },
        select: { id: true },
      }),
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
      prisma.user.findUniqueOrThrow({
        where: { login: 'deputy1' },
        select: { id: true },
      }),
    ]);

  const object = await prisma.object.create({
    data: {
      name: `Task access object ${marker}`,
      internalName: `TASK-${marker}`,
      address: `Москва, task access ${marker}`,
      status: 'active',
      dailyRate: 0,
      createdByUserId: founder.id,
      assignments: {
        create: [
          {
            userId: managerOne.id,
            assignmentRoleCode: 'manager',
            isActive: true,
          },
          {
            userId: managerTwo.id,
            assignmentRoleCode: 'manager',
            isActive: true,
          },
        ],
      },
    },
  });

  const inactiveUser = await prisma.user.create({
    data: {
      login: `inactive_task_${marker}`,
      fullName: 'Inactive task candidate',
      isActive: false,
    },
  });

  const [founderCookie, managerOneCookie, managerTwoCookie, hrCookie, deputyCookie] =
    await Promise.all([
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
      loginAndGetCookieHeader({
        baseUrl,
        login: 'hr1',
        password: 'hr123',
      }),
      loginAndGetCookieHeader({
        baseUrl,
        login: 'deputy1',
        password: 'deputy123',
      }),
    ]);
  const cookies = {
    founder: founderCookie,
    manager1: managerOneCookie,
    manager2: managerTwoCookie,
    hr1: hrCookie,
    deputy1: deputyCookie,
  };

  t.after(async () => {
    await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
    await prisma.object.delete({ where: { id: object.id } });
    await prisma.user.delete({ where: { id: inactiveUser.id } });
    await app.close();
    await prisma.$disconnect();
  });

  const createTask = async (
    cookie: string,
    body: Record<string, unknown>,
  ) => {
    const response = await fetch(`${baseUrl}/api/v1/tasks`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const payload = (await response.json()) as { id?: string; status?: string };
    if (payload.id) {
      createdTaskIds.push(payload.id);
    }

    return { response, payload };
  };

  const getTask = (cookie: string, taskId: string) =>
    fetch(`${baseUrl}/api/v1/tasks/${taskId}`, {
      headers: { Cookie: cookie },
    });

  for (const assigneeUserIds of [[], [''], ['   ']]) {
    const invalidAssignees = await createTask(cookies.manager1, {
      title: `Invalid assignees ${marker}`,
      priority: 'important_not_urgent',
      assigneeUserIds,
      visibilityMode: 'selected',
    });
    assert.equal(invalidAssignees.response.status, 400);
  }

  const invalidAssigneeId = await createTask(cookies.manager1, {
    title: `Invalid assignee ID ${marker}`,
    priority: 'important_not_urgent',
    assigneeUserIds: ['not-a-user-id'],
    visibilityMode: 'selected',
  });
  assert.equal(invalidAssigneeId.response.status, 400);

  const normalizedAssignees = await createTask(cookies.manager1, {
    title: `Normalized assignees ${marker}`,
    priority: 'important_not_urgent',
    assigneeUserIds: [managerOne.id, ` ${managerOne.id} `],
    visibilityMode: 'selected',
  });
  assert.equal(normalizedAssignees.response.status, 201);

  const personalTask = await createTask(cookies.hr1, {
    title: `Personal task ${marker}`,
    priority: 'important_not_urgent',
    assigneeUserIds: [managerOne.id],
    visibilityMode: 'selected',
    visibleUserIds: [managerTwo.id],
  });

  assert.equal(personalTask.response.status, 201);
  assert.equal(personalTask.payload.status, 'in_progress');
  assert.equal((await getTask(cookies.hr1, personalTask.payload.id!)).status, 200);
  assert.equal(
    (await getTask(cookies.manager1, personalTask.payload.id!)).status,
    200,
  );
  assert.equal(
    (await getTask(cookies.manager2, personalTask.payload.id!)).status,
    200,
  );
  assert.equal(
    (await getTask(cookies.founder, personalTask.payload.id!)).status,
    200,
  );
  assert.equal(
    (await getTask(cookies.deputy1, personalTask.payload.id!)).status,
    404,
  );

  const scopeTask = await createTask(cookies.founder, {
    title: `Scope task ${marker}`,
    priority: 'important_not_urgent',
    objectId: object.id,
    assigneeUserIds: [founder.id],
    visibilityMode: 'scope',
  });

  assert.equal(scopeTask.response.status, 201);
  assert.equal((await getTask(cookies.manager1, scopeTask.payload.id!)).status, 200);
  assert.equal((await getTask(cookies.manager2, scopeTask.payload.id!)).status, 200);

  const selectedTask = await createTask(cookies.founder, {
    title: `Selected task ${marker}`,
    priority: 'important_not_urgent',
    objectId: object.id,
    assigneeUserIds: [founder.id],
    visibilityMode: 'selected',
    visibleUserIds: [managerOne.id],
  });

  assert.equal(selectedTask.response.status, 201);
  assert.equal(
    (await getTask(cookies.manager1, selectedTask.payload.id!)).status,
    200,
  );
  assert.equal(
    (await getTask(cookies.manager2, selectedTask.payload.id!)).status,
    404,
  );

  const hiddenTask = await createTask(cookies.founder, {
    title: `Hidden marker ${marker}`,
    priority: 'important_not_urgent',
    assigneeUserIds: [founder.id],
    visibilityMode: 'selected',
  });

  assert.equal(hiddenTask.response.status, 201);
  assert.equal((await getTask(cookies.manager2, hiddenTask.payload.id!)).status, 404);
  assert.equal(
    (
      await fetch(
        `${baseUrl}/api/v1/tasks/${hiddenTask.payload.id}/completions`,
        { headers: { Cookie: cookies.manager2 } },
      )
    ).status,
    404,
  );

  const blankAddAssignees = await fetch(
    `${baseUrl}/api/v1/tasks/${personalTask.payload.id}/assignees`,
    {
      method: 'POST',
      headers: { Cookie: cookies.hr1, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: ['   '] }),
    },
  );
  assert.equal(blankAddAssignees.status, 400);

  const hiddenSearch = await fetch(
    `${baseUrl}/api/v1/tasks?q=${encodeURIComponent(`Hidden marker ${marker}`)}&page=1&limit=10`,
    { headers: { Cookie: cookies.manager2 } },
  );
  assert.equal(hiddenSearch.status, 200);
  const hiddenSearchPayload = (await hiddenSearch.json()) as {
    total: number;
    items: unknown[];
  };
  assert.equal(hiddenSearchPayload.total, 0);
  assert.deepEqual(hiddenSearchPayload.items, []);

  const founderSearch = await fetch(
    `${baseUrl}/api/v1/tasks?q=${encodeURIComponent(`Hidden marker ${marker}`)}&page=1&limit=10`,
    { headers: { Cookie: cookies.founder } },
  );
  const founderSearchPayload = (await founderSearch.json()) as {
    total: number;
  };
  assert.equal(founderSearchPayload.total, 1);

  const managerCreatedTask = await createTask(cookies.manager1, {
    title: `Manager object task ${marker}`,
    priority: 'important_not_urgent',
    objectId: object.id,
    assigneeUserIds: [hrUser.id],
    visibilityMode: 'scope',
  });
  assert.equal(managerCreatedTask.response.status, 201);

  const inactiveAssignee = await createTask(cookies.founder, {
    title: `Inactive assignee ${marker}`,
    priority: 'important_not_urgent',
    assigneeUserIds: [inactiveUser.id],
    visibilityMode: 'selected',
  });
  assert.equal(inactiveAssignee.response.status, 404);

  const candidatesResponse = await fetch(
    `${baseUrl}/api/v1/users-access/users?purpose=task_assignee`,
    { headers: { Cookie: cookies.hr1 } },
  );
  assert.equal(candidatesResponse.status, 200);
  const candidates = (await candidatesResponse.json()) as Array<{
    id: string;
    isActive: boolean;
  }>;
  assert.ok(candidates.some((candidate) => candidate.id === deputyDirector.id));
  assert.equal(candidates.some((candidate) => candidate.id === inactiveUser.id), false);
  assert.ok(candidates.every((candidate) => candidate.isActive));
});
