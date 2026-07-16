import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('one-time order specification supports checklist lifecycle, attachments and scoped access', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `spec-${Date.now()}`;
  const [founder, manager] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
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

  const [managerCookie, deputyCookie] = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: 'manager1',
      password: 'manager123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: 'deputy1',
      password: 'deputy123',
    }),
  ]);
  const itemsUrl = `${baseUrl}/api/v1/one-time-orders/${order.id}/specification-items`;

  const deniedCreate = await fetch(itemsUrl, {
    method: 'POST',
    headers: { Cookie: deputyCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Недоступный пункт' }),
  });
  assert.equal(deniedCreate.status, 404);

  const createResponse = await fetch(itemsUrl, {
    method: 'POST',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
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
  };
  createdItemIds.push(first.id);
  assert.equal(first.title, 'Проверить документы');
  assert.equal(first.sortOrder, 0);
  assert.equal(first.isCompleted, false);

  const completeUrl = `${itemsUrl}/${first.id}/complete`;
  assert.equal(
    (
      await fetch(completeUrl, {
        method: 'POST',
        headers: { Cookie: managerCookie },
      })
    ).status,
    409,
  );

  const file = await prisma.file.create({
    data: {
      bucket: 'integration-test',
      objectKey: `one-time-order-specification/${marker}.pdf`,
      originalName: 'specification.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      uploadedByUserId: manager.id,
      attachments: {
        create: {
          entityType: 'one_time_order_specification_item',
          entityId: first.id,
          uploadedByUserId: manager.id,
        },
      },
    },
  });
  createdFileIds.push(file.id);

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
  assert.deepEqual(completed.attachments.map((item) => item.id), [file.id]);
  assert.equal('bucket' in completed.attachments[0]!, false);
  assert.equal('objectKey' in completed.attachments[0]!, false);
  assert.equal('attachments' in completed.attachments[0]!, false);

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
  assert.equal(editCompleted.status, 409);

  const editAndReopen = await fetch(`${itemsUrl}/${first.id}`, {
    method: 'PATCH',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
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
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Второй пункт' }),
  });
  assert.equal(secondResponse.status, 201);
  const second = (await secondResponse.json()) as { id: string };
  createdItemIds.push(second.id);

  const reorderResponse = await fetch(`${itemsUrl}/reorder`, {
    method: 'PATCH',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
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
    headers: { Cookie: managerCookie },
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
  assert.ok(auditCount >= 7);
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

  const managerCookie = await loginAndGetCookieHeader({
    baseUrl,
    login: 'manager1',
    password: 'manager123',
  });
  const itemsUrl = `${baseUrl}/api/v1/one-time-orders/${order.id}/specification-items`;
  const createResponses = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      fetch(itemsUrl, {
        method: 'POST',
        headers: {
          Cookie: managerCookie,
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
      headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIds: [...ids].reverse() }),
    }),
    fetch(`${itemsUrl}/reorder`, {
      method: 'PATCH',
      headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
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
