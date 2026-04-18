import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { SEEDED_OBJECT_ID } from './helpers/core-fixtures';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('one-time order happy path supports manager scope, comments, files, tasks and isolated object linkage', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();

  const [managerOne, managerTwo] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { login: 'manager1' },
      select: { id: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { login: 'manager2' },
      select: { id: true },
    }),
  ]);

  let orderId: string | null = null;
  const createdFileIds: string[] = [];

  await prisma.objectAssignment.upsert({
    where: {
      objectId_userId_assignmentRoleCode: {
        objectId: SEEDED_OBJECT_ID,
        userId: managerTwo.id,
        assignmentRoleCode: 'manager',
      },
    },
    update: {
      isActive: true,
    },
    create: {
      objectId: SEEDED_OBJECT_ID,
      userId: managerTwo.id,
      assignmentRoleCode: 'manager',
      isActive: true,
    },
  });

  t.after(async () => {
    if (orderId) {
      const fileAttachmentFileIds = (
        await prisma.fileAttachment.findMany({
          where: {
            entityType: 'one_time_order',
            entityId: orderId,
          },
          select: {
            fileId: true,
          },
        })
      ).map((item) => item.fileId);

      createdFileIds.push(...fileAttachmentFileIds);

      await prisma.taskAssignee.deleteMany({
        where: {
          task: {
            oneTimeOrderId: orderId,
          },
        },
      });

      await prisma.task.deleteMany({
        where: {
          oneTimeOrderId: orderId,
        },
      });

      await prisma.oneTimeOrderComment.deleteMany({
        where: {
          oneTimeOrderId: orderId,
        },
      });

      await prisma.fileAttachment.deleteMany({
        where: {
          entityType: 'one_time_order',
          entityId: orderId,
        },
      });

      if (createdFileIds.length > 0) {
        await prisma.file.deleteMany({
          where: {
            id: {
              in: createdFileIds,
            },
          },
        });
      }

      await prisma.auditEvent.deleteMany({
        where: {
          entityType: 'one_time_order',
          entityId: orderId,
        },
      });

      await prisma.oneTimeOrderAssignment.deleteMany({
        where: {
          oneTimeOrderId: orderId,
        },
      });

      await prisma.oneTimeOrder.deleteMany({
        where: {
          id: orderId,
        },
      });
    }

    await prisma.objectAssignment.deleteMany({
      where: {
        objectId: SEEDED_OBJECT_ID,
        userId: managerTwo.id,
        assignmentRoleCode: 'manager',
      },
    });

    await app.close();
    await prisma.$disconnect();
  });

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

  const createResponse = await fetch(`${baseUrl}/api/v1/one-time-orders`, {
    method: 'POST',
    headers: {
      Cookie: founderCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `Integration one-time order ${Date.now()}`,
      executionAddress: 'Москва, тестовый адрес разового заказа, 3',
      linkedObjectId: SEEDED_OBJECT_ID,
      status: 'new',
      description: 'Integration one-time order scenario',
      executionDate: '2026-05-10',
      contactName: 'Тестовый контакт',
      contactPhone: '+79995550000',
      agreedSum: 15000,
      financialNotes: 'Согласовано устно',
      expenseNotes: 'Расходы уточняются',
      managerUserIds: [managerOne.id],
    }),
  });

  assert.equal(createResponse.status, 201);

  const createdOrder = (await createResponse.json()) as {
    id: string;
    linkedObject: { id: string; canOpenObjectCard: boolean } | null;
    managers: Array<{ userId: string }>;
  };

  orderId = createdOrder.id;
  assert.equal(createdOrder.linkedObject?.id, SEEDED_OBJECT_ID);
  assert.equal(createdOrder.linkedObject?.canOpenObjectCard, true);
  assert.ok(createdOrder.managers.some((manager) => manager.userId === managerOne.id));

  const ownOrderResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${orderId}`,
    {
      headers: {
        Cookie: managerOneCookie,
      },
    },
  );

  assert.equal(ownOrderResponse.status, 200);

  const foreignByLinkedObjectResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${orderId}`,
    {
      headers: {
        Cookie: managerTwoCookie,
      },
    },
  );

  assert.equal(foreignByLinkedObjectResponse.status, 404);

  const forbiddenEditResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${orderId}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: managerTwoCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: 'Manager outside order scope should not edit order',
      }),
    },
  );

  assert.equal(forbiddenEditResponse.status, 403);

  const commentResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${orderId}/comments`,
    {
      method: 'POST',
      headers: {
        Cookie: managerOneCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: 'Комментарий менеджера по заказу',
      }),
    },
  );

  assert.equal(commentResponse.status, 201);

  const form = new FormData();
  form.set('entityType', 'one_time_order');
  form.set('entityId', orderId);
  form.set(
    'file',
    new Blob(['one-time order attachment'], { type: 'text/plain' }),
    'one-time-order.txt',
  );

  const uploadResponse = await fetch(`${baseUrl}/api/v1/files/upload`, {
    method: 'POST',
    headers: {
      Cookie: managerOneCookie,
    },
    body: form,
  });

  assert.equal(uploadResponse.status, 201);

  const uploadedFile = (await uploadResponse.json()) as { id: string };
  createdFileIds.push(uploadedFile.id);

  const createTaskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: 'POST',
    headers: {
      Cookie: managerOneCookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `Integration order task ${Date.now()}`,
      description: 'Task linked to one-time order',
      priority: 'important_not_urgent',
      oneTimeOrderId: orderId,
      assigneeUserIds: [managerOne.id],
    }),
  });

  assert.equal(createTaskResponse.status, 201);

  const createdTask = (await createTaskResponse.json()) as {
    id: string;
    targetType: string;
    oneTimeOrderId: string | null;
  };

  assert.equal(createdTask.targetType, 'one_time_order');
  assert.equal(createdTask.oneTimeOrderId, orderId);

  const orderTasksResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${orderId}/tasks`,
    {
      headers: {
        Cookie: managerOneCookie,
      },
    },
  );

  assert.equal(orderTasksResponse.status, 200);

  const orderTasks = (await orderTasksResponse.json()) as Array<{ id: string }>;
  assert.ok(orderTasks.some((task) => task.id === createdTask.id));

  const statusChangeResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${orderId}/status`,
    {
      method: 'PATCH',
      headers: {
        Cookie: founderCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'in_progress',
      }),
    },
  );

  assert.equal(statusChangeResponse.status, 200);

  const updatedOrder = (await statusChangeResponse.json()) as { status: string };
  assert.equal(updatedOrder.status, 'in_progress');
});
