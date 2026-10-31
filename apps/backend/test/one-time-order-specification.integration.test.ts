import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('one-time order specification supports checklist lifecycle, attachments and scoped access', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `spec-${Date.now()}`;
  const [founder, manager, employee] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.employee.findFirstOrThrow({ select: { id: true } }),
  ]);
  const order = await prisma.oneTimeOrder.create({
    data: {
      title: marker,
      executionAddress: 'Москва',
      status: 'in_progress',
      contactName: 'Контакт',
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
  const createdItemIds: string[] = [];
  const createdFileIds: string[] = [];

  t.after(async () => {
    await prisma.fileAttachment.deleteMany({
      where: {
        entityType: 'one_time_order_specification_item',
        entityId: { in: createdItemIds },
      },
    });
    await prisma.file.deleteMany({ where: { id: { in: createdFileIds } } });
    await prisma.auditEvent.deleteMany({
      where: { entityType: 'one_time_order', entityId: order.id },
    });
    await prisma.oneTimeOrderSpecificationItem.deleteMany({
      where: { oneTimeOrderId: order.id },
    });
    await prisma.oneTimeOrderAssignment.deleteMany({
      where: { oneTimeOrderId: order.id },
    });
    await prisma.oneTimeOrder.delete({ where: { id: order.id } });
    await app.close();
    await prisma.$disconnect();
  });

  const [founderCookie, managerCookie, outsiderCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' }),
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
  const itemsUrl = `${baseUrl}/api/v1/one-time-orders/${order.id}/specification-items`;

  const deniedCreate = await fetch(itemsUrl, {
    method: 'POST',
    headers: { Cookie: outsiderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Недоступный пункт' }),
  });
  assert.equal(deniedCreate.status, 404);

  const managerStructuralCreate = await fetch(itemsUrl, {
    method: 'POST',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: '  Проверить документы  ',
      description: 'Приложить итоговый файл',
      requiresAttachment: true,
    }),
  });
  assert.equal(managerStructuralCreate.status, 403);

  const createResponse = await fetch(itemsUrl, {
    method: 'POST',
    headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: '  Проверить документы  ',
      description: 'Приложить итоговый файл',
      requiresAttachment: true,
    }),
  });
  assert.equal(createResponse.status, 201);
  const first = (await createResponse.json()) as {
    id: string;
    title: string;
    sortOrder: number;
    isCompleted: boolean;
    requiresAttachment: boolean;
  };
  createdItemIds.push(first.id);
  assert.equal(first.title, 'Проверить документы');
  assert.equal(first.sortOrder, 0);
  assert.equal(first.isCompleted, false);
  assert.equal(first.requiresAttachment, false);

  const completeUrl = `${itemsUrl}/${first.id}/complete`;
  assert.equal((await fetch(`${itemsUrl}/${first.id}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), content: 'Без авторизации' }),
  })).status, 401);
  for (const cookie of [founderCookie, outsiderCookie]) {
    const form = new FormData();
    form.set('entityType', 'one_time_order_specification_item');
    form.set('entityId', first.id);
    form.set('file', new Blob(['not uploaded'], { type: 'text/plain' }), 'denied.txt');
    assert.equal((await fetch(`${baseUrl}/api/v1/files/upload`, {
      method: 'POST', headers: { Cookie: cookie }, body: form,
    })).status, 403, 'only the active assigned manager may attach a file');
  }
  const completeWithoutAttachment = await fetch(completeUrl, {
    method: 'POST',
    headers: { Cookie: managerCookie },
  });
  assert.equal(completeWithoutAttachment.status, 201);
  assert.equal(((await completeWithoutAttachment.json()) as { isCompleted: boolean }).isCompleted, true);

  await fetch(`${itemsUrl}/${first.id}/reopen`, { method: 'POST', headers: { Cookie: managerCookie } });

  const uploadSpecificationFile = (uploadId: string, content: Blob) => {
    const form = new FormData();
    form.set('entityType', 'one_time_order_specification_item');
    form.set('entityId', first.id);
    form.set('uploadId', uploadId);
    form.set('originalName', 'specification.txt');
    form.set('file', content, 'specification.txt');
    return fetch(`${baseUrl}/api/v1/files/upload`, {
      method: 'POST',
      headers: { Cookie: managerCookie },
      body: form,
    });
  };
  const fileUploadId = randomUUID();
  const fileContent = 'Specification upload stored and served through FilesService.';
  const fileUploadResponse = await uploadSpecificationFile(
    fileUploadId,
    new Blob([fileContent], { type: 'text/plain' }),
  );
  assert.equal(fileUploadResponse.status, 201, await fileUploadResponse.clone().text());
  const uploadedFile = (await fileUploadResponse.json()) as {
    id: string;
    originalName: string;
    viewUrl: string;
    downloadUrl: string;
  };
  const file = { id: uploadedFile.id };
  createdFileIds.push(file.id);
  assert.equal(file.id, fileUploadId);
  assert.equal(uploadedFile.originalName, 'specification.txt');

  const fileViewResponse = await fetch(new URL(uploadedFile.viewUrl, baseUrl), {
    headers: { Cookie: managerCookie },
  });
  assert.equal(fileViewResponse.status, 200);
  assert.equal(((await fileViewResponse.json()) as { id: string }).id, file.id);
  const fileContentResponse = await fetch(new URL(uploadedFile.downloadUrl, baseUrl), {
    headers: { Cookie: managerCookie },
  });
  assert.equal(fileContentResponse.status, 200);
  assert.equal(await fileContentResponse.text(), fileContent);

  const uploadRetryResponse = await uploadSpecificationFile(
    fileUploadId,
    new Blob(['retry payload'], { type: 'text/plain' }),
  );
  assert.equal(uploadRetryResponse.status, 201, await uploadRetryResponse.clone().text());
  assert.equal(((await uploadRetryResponse.json()) as { id: string }).id, file.id);
  assert.equal(await prisma.fileAttachment.count({
    where: { fileId: file.id, entityType: 'one_time_order_specification_item', entityId: first.id },
  }), 1);

  const oversizedUploadId = randomUUID();
  const [validBatchResponse, oversizedBatchResponse] = await Promise.all([
    uploadSpecificationFile(randomUUID(), new Blob(['valid batch file'], { type: 'text/plain' })),
    uploadSpecificationFile(
      oversizedUploadId,
      new Blob([new Uint8Array(26 * 1024 * 1024)], { type: 'text/plain' }),
    ),
  ]);
  assert.equal(validBatchResponse.status, 201, await validBatchResponse.clone().text());
  const validBatchFile = (await validBatchResponse.json()) as { id: string };
  createdFileIds.push(validBatchFile.id);
  assert.equal(oversizedBatchResponse.status, 413, await oversizedBatchResponse.clone().text());
  assert.equal(await prisma.file.findUnique({ where: { id: oversizedUploadId } }), null);
  assert.equal(await prisma.fileAttachment.count({
    where: { entityType: 'one_time_order_specification_item', entityId: first.id },
  }), 2, 'the rejected oversized upload creates no attachment; the valid upload remains attached');
  assert.ok(await prisma.file.findUnique({ where: { id: validBatchFile.id } }));

  const detachUrl = `${itemsUrl}/${first.id}/attachments/${file.id}`;
  assert.equal((await fetch(detachUrl, { method: 'DELETE', headers: { Cookie: outsiderCookie } })).status, 404);
  const detachedResponse = await fetch(detachUrl, { method: 'DELETE', headers: { Cookie: managerCookie } });
  assert.equal(detachedResponse.status, 200);
  assert.deepEqual(
    ((await detachedResponse.json()) as { attachments: Array<{ id: string }> }).attachments.map(({ id }) => id),
    [validBatchFile.id],
  );
  assert.ok(await prisma.file.findUnique({ where: { id: file.id } }), 'detaching must preserve the file record');
  assert.equal(await prisma.fileAttachment.count({ where: { fileId: file.id } }), 0);
  const validBatchDetachResponse = await fetch(
    `${itemsUrl}/${first.id}/attachments/${validBatchFile.id}`,
    { method: 'DELETE', headers: { Cookie: managerCookie } },
  );
  assert.equal(validBatchDetachResponse.status, 200);
  assert.deepEqual(((await validBatchDetachResponse.json()) as { attachments: unknown[] }).attachments, []);
  assert.ok(await prisma.file.findUnique({ where: { id: validBatchFile.id } }));

  const commentsUrl = `${itemsUrl}/${first.id}/comments`;
  const commentPayload = {
    requestId: 'e2851243-c818-4d40-b142-f9ab055b0c42',
    content: 'Повторно проверил, замечаний нет.',
  };
  assert.equal((await fetch(commentsUrl, {
    method: 'POST', headers: { Cookie: outsiderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...commentPayload, requestId: '74266394-30c1-416c-8523-ae24115e6b5f' }),
  })).status, 404);
  const forgedActorResponse = await fetch(commentsUrl, {
    method: 'POST',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: randomUUID(),
      content: 'Попытка подменить автора',
      createdByUserId: founder.id,
      employeeId: employee.id,
    }),
  });
  assert.equal(forgedActorResponse.status, 400);
  const commentResponse = await fetch(commentsUrl, {
    method: 'POST', headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(commentPayload),
  });
  assert.equal(commentResponse.status, 201);
  const firstComment = (await commentResponse.json()) as { id: string; createdBy: { id: string }; content: string };
  assert.equal(firstComment.createdBy.id, manager.id);
  assert.equal(firstComment.content, commentPayload.content);
  const retryCommentResponse = await fetch(commentsUrl, {
    method: 'POST', headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(commentPayload),
  });
  assert.equal(retryCommentResponse.status, 201);
  assert.equal(((await retryCommentResponse.json()) as { id: string }).id, firstComment.id);
  const mismatchedRetry = await fetch(commentsUrl, {
    method: 'POST', headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...commentPayload, content: 'Другой текст с прежним ключом' }),
  });
  assert.equal(mismatchedRetry.status, 409);
  const concurrentCommentPayload = {
    requestId: '2892818f-7106-4f52-b42b-a985b47109d3',
    content: 'Подробное замечание. '.repeat(80),
  };
  const concurrentCommentRequests = await Promise.all([1, 2].map(() => fetch(commentsUrl, {
    method: 'POST', headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(concurrentCommentPayload),
  })));
  assert.deepEqual(concurrentCommentRequests.map((response) => response.status), [201, 201]);
  const concurrentCommentIds = await Promise.all(concurrentCommentRequests.map(async (response) => ((await response.json()) as { id: string }).id));
  assert.equal(concurrentCommentIds[0], concurrentCommentIds[1]);
  const visibleComments = (await (await fetch(commentsUrl, { headers: { Cookie: managerCookie } })).json()) as Array<{ content: string }>;
  assert.equal(visibleComments.length, 2);
  assert.ok(visibleComments.some((comment) => comment.content === concurrentCommentPayload.content.trim()));

  const completeResponse = await fetch(completeUrl, {
    method: 'POST',
    headers: { Cookie: managerCookie },
  });
  assert.equal(completeResponse.status, 201);
  const completed = (await completeResponse.json()) as {
    isCompleted: boolean;
    completedBy: { id: string } | null;
    attachments: Array<{ id: string }>;
  };
  assert.equal(completed.isCompleted, true);
  assert.equal(completed.completedBy?.id, manager.id);
  assert.deepEqual(completed.attachments, []);

  const firstCompletedAt = (
    await prisma.oneTimeOrderSpecificationItem.findUniqueOrThrow({
      where: { id: first.id },
      select: { completedAt: true },
    })
  ).completedAt;
  const duplicateCompleteResponse = await fetch(completeUrl, {
    method: 'POST',
    headers: { Cookie: managerCookie },
  });
  assert.equal(duplicateCompleteResponse.status, 201);
  assert.equal(
    (
      await prisma.oneTimeOrderSpecificationItem.findUniqueOrThrow({
        where: { id: first.id },
        select: { completedAt: true },
      })
    ).completedAt?.toISOString(),
    firstCompletedAt?.toISOString(),
  );

  const editCompleted = await fetch(`${itemsUrl}/${first.id}`, {
    method: 'PATCH',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Изменённый выполненный пункт' }),
  });
  assert.equal(editCompleted.status, 403);

  const leadershipEditCompleted = await fetch(`${itemsUrl}/${first.id}`, {
    method: 'PATCH',
    headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Изменённый выполненный пункт' }),
  });
  assert.equal(leadershipEditCompleted.status, 409);

  await fetch(`${itemsUrl}/${first.id}/reopen`, {
    method: 'POST',
    headers: { Cookie: managerCookie },
  });

  const editAndReopen = await fetch(`${itemsUrl}/${first.id}`, {
    method: 'PATCH',
    headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Изменённый выполненный пункт',
      reopenCompleted: true,
    }),
  });
  assert.equal(editAndReopen.status, 200);
  assert.equal(
    ((await editAndReopen.json()) as { isCompleted: boolean }).isCompleted,
    false,
  );

  await fetch(completeUrl, { method: 'POST', headers: { Cookie: managerCookie } });
  const reopenResponse = await fetch(`${itemsUrl}/${first.id}/reopen`, {
    method: 'POST',
    headers: { Cookie: managerCookie },
  });
  assert.equal(reopenResponse.status, 201);
  assert.equal(
    ((await reopenResponse.json()) as { isCompleted: boolean }).isCompleted,
    false,
  );

  const secondResponse = await fetch(itemsUrl, {
    method: 'POST',
    headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Второй пункт' }),
  });
  assert.equal(secondResponse.status, 201);
  const second = (await secondResponse.json()) as { id: string };
  createdItemIds.push(second.id);

  const reorderResponse = await fetch(`${itemsUrl}/reorder`, {
    method: 'PATCH',
    headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemIds: [second.id, first.id] }),
  });
  assert.equal(reorderResponse.status, 200);
  const reordered = (await reorderResponse.json()) as Array<{
    id: string;
    sortOrder: number;
  }>;
  assert.deepEqual(
    reordered.map((item) => [item.id, item.sortOrder]),
    [
      [second.id, 0],
      [first.id, 1],
    ],
  );

  const deleteResponse = await fetch(`${itemsUrl}/${second.id}`, {
    method: 'DELETE',
    headers: { Cookie: founderCookie },
  });
  assert.equal(deleteResponse.status, 200);
  assert.ok(
    (
      await prisma.oneTimeOrderSpecificationItem.findUniqueOrThrow({
        where: { id: second.id },
      })
    ).deletedAt,
  );

  const listResponse = await fetch(itemsUrl, {
    headers: { Cookie: managerCookie },
  });
  assert.equal(listResponse.status, 200);
  const listed = (await listResponse.json()) as Array<{ id: string }>;
  assert.deepEqual(listed.map((item) => item.id), [first.id]);

  const auditCount = await prisma.auditEvent.count({
    where: {
      entityType: 'one_time_order',
      entityId: order.id,
      action: { startsWith: 'one_time_order.specification' },
    },
  });
  assert.ok(auditCount >= 10, 'R2 comment and attachment changes should be recorded in order history');

  await prisma.fileAttachment.create({
    data: { fileId: file.id, entityType: 'one_time_order_specification_item', entityId: first.id, uploadedByUserId: manager.id },
  });
  await prisma.oneTimeOrder.update({ where: { id: order.id }, data: { status: 'completed' } });
  assert.equal((await fetch(commentsUrl, { headers: { Cookie: managerCookie } })).status, 200, 'closed orders remain readable');
  assert.equal((await fetch(`${itemsUrl}/${first.id}/comments`, {
    method: 'POST', headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: 'c35232e8-8f64-4606-9fd5-c338a3d32f1b', content: 'После закрытия' }),
  })).status, 409);
  assert.equal((await fetch(detachUrl, { method: 'DELETE', headers: { Cookie: managerCookie } })).status, 409);
  assert.equal(await prisma.fileAttachment.count({ where: { fileId: file.id } }), 1);

  await prisma.oneTimeOrder.update({ where: { id: order.id }, data: { status: 'in_progress' } });
  await prisma.oneTimeOrderAssignment.updateMany({
    where: { oneTimeOrderId: order.id, userId: manager.id }, data: { isActive: false },
  });
  assert.equal((await fetch(`${itemsUrl}/${first.id}/comments`, {
    method: 'POST', headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: '657a7aca-e36f-4e7d-a7f6-9bf1bfcaed61', content: 'После снятия назначения' }),
  })).status, 404);
  assert.equal((await fetch(detachUrl, { method: 'DELETE', headers: { Cookie: managerCookie } })).status, 404);
  assert.equal(await prisma.fileAttachment.count({ where: { fileId: file.id } }), 1);
});

test('one-time order specification serializes parallel create and reorder', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const [founder, manager] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
  ]);
  const order = await prisma.oneTimeOrder.create({
    data: {
      title: `Parallel specification ${Date.now()}`,
      executionAddress: 'Москва',
      status: 'in_progress',
      contactName: 'Контакт',
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

  t.after(async () => {
    await prisma.auditEvent.deleteMany({
      where: { entityType: 'one_time_order', entityId: order.id },
    });
    await prisma.oneTimeOrderSpecificationItem.deleteMany({
      where: { oneTimeOrderId: order.id },
    });
    await prisma.oneTimeOrderAssignment.deleteMany({
      where: { oneTimeOrderId: order.id },
    });
    await prisma.oneTimeOrder.delete({ where: { id: order.id } });
    await app.close();
    await prisma.$disconnect();
  });

  const founderCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'founder',
    password: 'founder123',
  });
  const itemsUrl = `${baseUrl}/api/v1/one-time-orders/${order.id}/specification-items`;
  const createResponses = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      fetch(itemsUrl, {
        method: 'POST',
        headers: {
          Cookie: founderCookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: `Параллельный пункт ${index + 1}` }),
      }),
    ),
  );
  assert.deepEqual(createResponses.map((response) => response.status), [201, 201, 201, 201]);

  const createdItems = await prisma.oneTimeOrderSpecificationItem.findMany({
    where: { oneTimeOrderId: order.id, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, sortOrder: true },
  });
  assert.deepEqual(
    createdItems.map((item) => item.sortOrder),
    [0, 1, 2, 3],
  );

  const ids = createdItems.map((item) => item.id);
  const reorderResponses = await Promise.all([
    fetch(`${itemsUrl}/reorder`, {
      method: 'PATCH',
      headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds: [...ids].reverse() }),
    }),
    fetch(`${itemsUrl}/reorder`, {
      method: 'PATCH',
      headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds: [ids[1], ids[3], ids[0], ids[2]] }),
    }),
  ]);
  assert.deepEqual(reorderResponses.map((response) => response.status), [200, 200]);

  const finalItems = await prisma.oneTimeOrderSpecificationItem.findMany({
    where: { oneTimeOrderId: order.id, deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, sortOrder: true },
  });
  assert.deepEqual(
    finalItems.map((item) => item.sortOrder),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    [...finalItems.map((item) => item.id)].sort(),
    [...ids].sort(),
  );
});
