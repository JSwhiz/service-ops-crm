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
  let legacyOrderId: string | null = null;
  let commentId: string | null = null;
  let reportId: string | null = null;
  let photoId: string | null = null;
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
      const attachmentEntityFilters = [
        {
          entityType: 'one_time_order',
          entityId: orderId,
        },
        ...(commentId
          ? [
              {
                entityType: 'one_time_order_comment',
                entityId: commentId,
              },
            ]
          : []),
        ...(reportId
          ? [
              {
                entityType: 'one_time_order_daily_report',
                entityId: reportId,
              },
            ]
          : []),
        ...(photoId
          ? [
              {
                entityType: 'one_time_order_photo',
                entityId: photoId,
              },
            ]
          : []),
      ] as Array<{ entityType: string; entityId: string }>;

      const fileAttachmentFileIds = (
        await prisma.fileAttachment.findMany({
          where: {
            OR: attachmentEntityFilters,
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

      await prisma.oneTimeOrderPhoto.deleteMany({
        where: {
          oneTimeOrderId: orderId,
        },
      });

      await prisma.oneTimeOrderDailyReport.deleteMany({
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
          OR: attachmentEntityFilters,
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

    if (legacyOrderId) {
      await prisma.oneTimeOrder.deleteMany({ where: { id: legacyOrderId } });
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

  const requiredCreateFields = {
    title: `Payment validation ${Date.now()}`,
    executionAddress: 'Москва, проверка способа оплаты',
    contactName: 'Тестовый контакт',
  };
  const missingPaymentMethod = await fetch(
    `${baseUrl}/api/v1/one-time-orders`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(requiredCreateFields),
    },
  );
  assert.equal(missingPaymentMethod.status, 400);
  const invalidPaymentMethod = await fetch(
    `${baseUrl}/api/v1/one-time-orders`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...requiredCreateFields,
        plannedPaymentMethod: 'crypto',
      }),
    },
  );
  assert.equal(invalidPaymentMethod.status, 400);

  const legacyOrder = await prisma.oneTimeOrder.create({
    data: {
      title: `Legacy payment method ${Date.now()}`,
      executionAddress: 'Москва',
      status: 'new',
      contactName: 'Legacy contact',
      createdByUserId: managerOne.id,
    },
  });
  legacyOrderId = legacyOrder.id;
  const legacyResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${legacyOrder.id}`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(legacyResponse.status, 200);
  assert.equal(
    ((await legacyResponse.json()) as { plannedPaymentMethod: string | null })
      .plannedPaymentMethod,
    null,
  );

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
      plannedPaymentMethod: 'cash',
      financialNotes: 'Согласовано устно',
      expenseNotes: 'Расходы уточняются',
      managerUserIds: [managerOne.id],
    }),
  });

  assert.equal(createResponse.status, 201);

  const createdOrder = (await createResponse.json()) as {
    id: string;
    plannedPaymentMethod: string | null;
    linkedObject: { id: string; canOpenObjectCard: boolean } | null;
    managers: Array<{ userId: string }>;
  };

  orderId = createdOrder.id;
  assert.equal(createdOrder.plannedPaymentMethod, 'cash');
  assert.equal(createdOrder.linkedObject?.id, SEEDED_OBJECT_ID);

  const operationalFinancialPatch = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${orderId}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: managerOneCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ plannedPaymentMethod: 'other' }),
    },
  );
  assert.equal(operationalFinancialPatch.status, 403);

  for (const plannedPaymentMethod of [
    'cash',
    'personal_card_transfer',
    'organization_transfer',
    'other',
  ]) {
    const updatePaymentMethod = await fetch(
      `${baseUrl}/api/v1/one-time-orders/${orderId}`,
      {
        method: 'PATCH',
        headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plannedPaymentMethod }),
      },
    );
    assert.equal(updatePaymentMethod.status, 200);
    assert.equal(
      ((await updatePaymentMethod.json()) as { plannedPaymentMethod: string })
        .plannedPaymentMethod,
      plannedPaymentMethod,
    );
  }
  assert.equal(
    await prisma.oneTimeOrderCompletionPayment.count({
      where: { oneTimeOrderId: orderId },
    }),
    0,
  );
  assert.equal(
    await prisma.accountabilityFunding.count({
      where: { oneTimeOrderId: orderId },
    }),
    0,
  );
  const plannedMethodAudit = await prisma.auditEvent.findFirst({
    where: {
      entityType: 'one_time_order',
      entityId: orderId,
      action: 'one_time_order.updated',
    },
    orderBy: { createdAt: 'desc' },
  });
  assert.match(
    JSON.stringify(plannedMethodAudit?.metadata),
    /plannedPaymentMethod/,
  );
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

  const allowedScopedEditResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${orderId}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: managerOneCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: 'Менеджер заказа обновил описание в рамках своего scope',
      }),
    },
  );

  assert.equal(allowedScopedEditResponse.status, 200);

  const forbiddenRelinkResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${orderId}`,
    {
      method: 'PATCH',
      headers: {
        Cookie: managerOneCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        linkedObjectId: null,
      }),
    },
  );

  assert.equal(forbiddenRelinkResponse.status, 403);

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

  assert.equal(forbiddenEditResponse.status, 404);

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

  const createdComment = (await commentResponse.json()) as { id: string };
  commentId = createdComment.id;

  const commentAttachmentForm = new FormData();
  commentAttachmentForm.set('entityType', 'one_time_order_comment');
  commentAttachmentForm.set('entityId', createdComment.id);
  commentAttachmentForm.set(
    'file',
    new Blob(['comment image'], { type: 'image/jpeg' }),
    'comment.jpg',
  );

  const commentUploadResponse = await fetch(`${baseUrl}/api/v1/files/upload`, {
    method: 'POST',
    headers: {
      Cookie: managerOneCookie,
    },
    body: commentAttachmentForm,
  });

  assert.equal(commentUploadResponse.status, 201);

  createdFileIds.push(((await commentUploadResponse.json()) as { id: string }).id);

  const dailyReportResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${orderId}/daily-report/today`,
    {
      method: 'PUT',
      headers: {
        Cookie: managerOneCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: 'Сегодня выполнен выезд по заказу',
      }),
    },
  );

  assert.equal(dailyReportResponse.status, 200);

  const createdReport = (await dailyReportResponse.json()) as { id: string };
  reportId = createdReport.id;

  const reportAttachmentForm = new FormData();
  reportAttachmentForm.set('entityType', 'one_time_order_daily_report');
  reportAttachmentForm.set('entityId', createdReport.id);
  reportAttachmentForm.set(
    'file',
    new Blob(['report image'], { type: 'image/jpeg' }),
    'report.jpg',
  );

  const reportUploadResponse = await fetch(`${baseUrl}/api/v1/files/upload`, {
    method: 'POST',
    headers: {
      Cookie: managerOneCookie,
    },
    body: reportAttachmentForm,
  });

  assert.equal(reportUploadResponse.status, 201);

  createdFileIds.push(((await reportUploadResponse.json()) as { id: string }).id);

  const photoCreateResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${orderId}/photos`,
    {
      method: 'POST',
      headers: {
        Cookie: managerOneCookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        category: 'before',
        comment: 'Фото до начала работ',
      }),
    },
  );

  assert.equal(photoCreateResponse.status, 201);

  const createdPhoto = (await photoCreateResponse.json()) as { id: string };
  photoId = createdPhoto.id;

  const photoAttachmentForm = new FormData();
  photoAttachmentForm.set('entityType', 'one_time_order_photo');
  photoAttachmentForm.set('entityId', createdPhoto.id);
  photoAttachmentForm.set(
    'file',
    new Blob(['before image'], { type: 'image/jpeg' }),
    'before.jpg',
  );

  const photoUploadResponse = await fetch(`${baseUrl}/api/v1/files/upload`, {
    method: 'POST',
    headers: {
      Cookie: managerOneCookie,
    },
    body: photoAttachmentForm,
  });

  assert.equal(photoUploadResponse.status, 201);

  createdFileIds.push(((await photoUploadResponse.json()) as { id: string }).id);

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

  const linkedOrdersProjectionResponse = await fetch(
    `${baseUrl}/api/v1/objects/${SEEDED_OBJECT_ID}/linked-one-time-orders`,
    {
      headers: {
        Cookie: founderCookie,
      },
    },
  );

  assert.equal(linkedOrdersProjectionResponse.status, 200);

  const linkedOrders = (await linkedOrdersProjectionResponse.json()) as Array<{
    id: string;
    summary: {
      commentsCount: number;
      reportsCount: number;
      photosCount: number;
      filesCount: number;
      tasksCount: number;
    };
  }>;

  const linkedOrder = linkedOrders.find((item) => item.id === orderId);

  assert.ok(linkedOrder);
  assert.equal(linkedOrder.summary.commentsCount, 1);
  assert.equal(linkedOrder.summary.reportsCount, 1);
  assert.equal(linkedOrder.summary.photosCount, 1);
  assert.equal(linkedOrder.summary.filesCount, 1);
  assert.equal(linkedOrder.summary.tasksCount, 1);
});
