import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('one-time order task linkage keeps task visibility authoritative', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `order-task-link-${Date.now()}`;
  const [founder, manager, orderReader] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } }),
  ]);
  const object = await prisma.object.create({
    data: {
      name: marker,
      address: 'Москва',
      status: 'active',
      createdByUserId: founder.id,
      assignments: {
        create: [
          {
            userId: manager.id,
            assignmentRoleCode: 'manager',
            isActive: true,
          },
          {
            userId: orderReader.id,
            assignmentRoleCode: 'manager',
            isActive: true,
          },
        ],
      },
    },
  });
  const order = await prisma.oneTimeOrder.create({
    data: {
      title: marker,
      executionAddress: 'Москва',
      status: 'in_progress',
      contactName: 'Контакт',
      linkedObjectId: object.id,
      createdByUserId: founder.id,
      assignments: {
        create: [
          {
            userId: manager.id,
            assignmentRoleCode: 'one_time_manager',
            isActive: true,
          },
          {
            userId: orderReader.id,
            assignmentRoleCode: 'one_time_manager',
            isActive: true,
          },
        ],
      },
    },
  });
  const createdTaskIds: string[] = [];

  t.after(async () => {
    await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
    await prisma.oneTimeOrderAssignment.deleteMany({
      where: { oneTimeOrderId: order.id },
    });
    await prisma.oneTimeOrder.delete({ where: { id: order.id } });
    await prisma.objectAssignment.deleteMany({ where: { objectId: object.id } });
    await prisma.object.delete({ where: { id: object.id } });
    await app.close();
    await prisma.$disconnect();
  });

  const [founderCookie, managerCookie, readerCookie] = await Promise.all([
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
  const createTask = async (payload: Record<string, unknown>) => {
    const response = await fetch(`${baseUrl}/api/v1/tasks`, {
      method: 'POST',
      headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `Task ${marker}`,
        priority: 'important_not_urgent',
        assigneeUserIds: [manager.id],
        requiresConfirmation: true,
        completionRequirement: 'comment_or_file',
        ...payload,
      }),
    });
    assert.equal(response.status, 201);
    const task = (await response.json()) as {
      id: string;
      targetType: string;
      object: { id: string } | null;
      oneTimeOrder: { id: string } | null;
    };
    createdTaskIds.push(task.id);
    return task;
  };

  const orderOnly = await createTask({
    oneTimeOrderId: order.id,
    visibilityMode: 'selected',
    visibleUserIds: [manager.id],
  });
  assert.equal(orderOnly.targetType, 'one_time_order');
  assert.equal(orderOnly.object, null);
  assert.equal(orderOnly.oneTimeOrder?.id, order.id);

  const orderAndObject = await createTask({
    objectId: object.id,
    oneTimeOrderId: order.id,
    visibilityMode: 'selected',
    visibleUserIds: [manager.id],
  });
  assert.equal(orderAndObject.targetType, 'both');
  assert.equal(orderAndObject.object?.id, object.id);
  assert.equal(orderAndObject.oneTimeOrder?.id, order.id);

  const terminalTasks = await Promise.all(
    [
      { status: 'completed', completedAt: new Date() },
      {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancellationReason: 'Отменено в integration test',
      },
    ].map((state, index) =>
      prisma.task.create({
        data: {
          title: `${marker}-terminal-${index}`,
          priority: 'important_not_urgent',
          createdByUserId: manager.id,
          oneTimeOrderId: order.id,
          visibilityMode: 'selected',
          requiresConfirmation: true,
          completionRequirement: 'comment_or_file',
          ...state,
          assignees: {
            create: { userId: manager.id },
          },
          visibilityUsers: {
            create: {
              userId: manager.id,
              addedByUserId: manager.id,
            },
          },
        },
      }),
    ),
  );
  createdTaskIds.push(...terminalTasks.map((task) => task.id));

  const orderTasksUrl = `${baseUrl}/api/v1/one-time-orders/${order.id}/tasks`;
  const managerTasksResponse = await fetch(orderTasksUrl, {
    headers: { Cookie: managerCookie },
  });
  assert.equal(managerTasksResponse.status, 200);
  const managerTasks = (await managerTasksResponse.json()) as Array<{
    id: string;
    status: string;
  }>;
  assert.equal(managerTasks.length, 4);
  assert.ok(managerTasks.some((task) => task.status === 'completed'));
  assert.ok(managerTasks.some((task) => task.status === 'cancelled'));

  const readerTasksResponse = await fetch(orderTasksUrl, {
    headers: { Cookie: readerCookie },
  });
  assert.equal(readerTasksResponse.status, 200);
  assert.deepEqual(await readerTasksResponse.json(), []);

  const updateUrl = `${baseUrl}/api/v1/tasks/${orderAndObject.id}`;
  const unlinkResponse = await fetch(updateUrl, {
    method: 'PATCH',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ objectId: null }),
  });
  assert.equal(unlinkResponse.status, 200);
  assert.equal(
    ((await unlinkResponse.json()) as { targetType: string }).targetType,
    'one_time_order',
  );

  const relinkResponse = await fetch(updateUrl, {
    method: 'PATCH',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ objectId: object.id }),
  });
  assert.equal(relinkResponse.status, 200);
  assert.equal(
    ((await relinkResponse.json()) as { targetType: string }).targetType,
    'both',
  );

  const projectionUrl = `${baseUrl}/api/v1/objects/${object.id}/linked-one-time-orders`;
  const readTaskCount = async (cookie: string) => {
    const response = await fetch(projectionUrl, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    const orders = (await response.json()) as Array<{
      id: string;
      summary: { tasksCount: number };
    }>;
    return orders.find((item) => item.id === order.id)?.summary.tasksCount;
  };
  assert.equal(await readTaskCount(founderCookie), 4);
  assert.equal(await readTaskCount(managerCookie), 4);
  assert.equal(await readTaskCount(readerCookie), 0);
});
