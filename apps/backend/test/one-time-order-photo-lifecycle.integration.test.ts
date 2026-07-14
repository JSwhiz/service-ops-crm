import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('one-time order photos support scoped soft delete, restore and file access', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `photo-lifecycle-${Date.now()}`;
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
  const photos = await Promise.all(
    ['manager', 'creator', 'leadership'].map((suffix) =>
      prisma.oneTimeOrderPhoto.create({
        data: {
          oneTimeOrderId: order.id,
          photoCategory: 'before',
          comment: `${marker}-${suffix}`,
          createdByUserId: manager.id,
        },
      }),
    ),
  );
  const managerPhoto = photos[0]!;
  const creatorManagedPhoto = photos[1]!;
  const leadershipManagedPhoto = photos[2]!;
  const privateFile = await prisma.file.create({
    data: {
      bucket: 'integration-test',
      objectKey: `${marker}/private.jpg`,
      originalName: 'private.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      uploadedByUserId: manager.id,
      attachments: {
        create: {
          entityType: 'one_time_order_photo',
          entityId: managerPhoto.id,
          uploadedByUserId: manager.id,
        },
      },
    },
  });
  const sharedFile = await prisma.file.create({
    data: {
      bucket: 'integration-test',
      objectKey: `${marker}/shared.jpg`,
      originalName: 'shared.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      uploadedByUserId: manager.id,
      attachments: {
        create: [
          {
            entityType: 'one_time_order_photo',
            entityId: managerPhoto.id,
            uploadedByUserId: manager.id,
          },
          {
            entityType: 'one_time_order',
            entityId: order.id,
            uploadedByUserId: manager.id,
          },
        ],
      },
    },
  });

  t.after(async () => {
    await prisma.fileAttachment.deleteMany({
      where: { fileId: { in: [privateFile.id, sharedFile.id] } },
    });
    await prisma.file.deleteMany({
      where: { id: { in: [privateFile.id, sharedFile.id] } },
    });
    await prisma.auditEvent.deleteMany({
      where: { entityType: 'one_time_order', entityId: order.id },
    });
    await prisma.oneTimeOrderPhoto.deleteMany({
      where: { oneTimeOrderId: order.id },
    });
    await prisma.oneTimeOrderAssignment.deleteMany({
      where: { oneTimeOrderId: order.id },
    });
    await prisma.oneTimeOrder.delete({ where: { id: order.id } });
    await app.close();
    await prisma.$disconnect();
  });

  const [founderCookie, directorCookie, managerCookie, outsiderCookie] =
    await Promise.all([
      loginAndGetCookieHeader({
        baseUrl,
        login: 'founder',
        password: 'founder123',
      }),
      loginAndGetCookieHeader({
        baseUrl,
        login: 'director',
        password: 'director123',
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
  const photoUrl = (photoId: string) =>
    `${baseUrl}/api/v1/one-time-orders/${order.id}/photos/${photoId}`;
  const fileUrl = (fileId: string) => `${baseUrl}/api/v1/files/${fileId}`;

  assert.equal(
    (await fetch(fileUrl(privateFile.id), { headers: { Cookie: managerCookie } }))
      .status,
    200,
  );

  const outsiderDenied = await fetch(photoUrl(managerPhoto.id), {
    method: 'DELETE',
    headers: { Cookie: outsiderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Недоступно' }),
  });
  assert.equal(outsiderDenied.status, 403);

  const managerDelete = await fetch(photoUrl(managerPhoto.id), {
    method: 'DELETE',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: '  Дубликат фото  ' }),
  });
  assert.equal(managerDelete.status, 200);
  const deleted = (await managerDelete.json()) as {
    deletedAt: string | null;
    deletedBy: { id: string } | null;
    deleteReason: string | null;
    attachments: Array<{ id: string }>;
    capabilities: { canDelete: boolean; canRestore: boolean };
  };
  assert.ok(deleted.deletedAt);
  assert.equal(deleted.deletedBy?.id, manager.id);
  assert.equal(deleted.deleteReason, 'Дубликат фото');
  assert.deepEqual(deleted.attachments, []);
  assert.deepEqual(deleted.capabilities, {
    canDelete: false,
    canRestore: true,
  });

  const repeatedDelete = await fetch(photoUrl(managerPhoto.id), {
    method: 'DELETE',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(repeatedDelete.status, 200);
  assert.equal(
    ((await repeatedDelete.json()) as { deletedAt: string }).deletedAt,
    deleted.deletedAt,
  );

  const activeList = (await (
    await fetch(`${baseUrl}/api/v1/one-time-orders/${order.id}/photos`, {
      headers: { Cookie: managerCookie },
    })
  ).json()) as Array<{ id: string }>;
  assert.equal(activeList.some((item) => item.id === managerPhoto.id), false);

  const archivedList = (await (
    await fetch(
      `${baseUrl}/api/v1/one-time-orders/${order.id}/photos?includeDeleted=true`,
      { headers: { Cookie: managerCookie } },
    )
  ).json()) as Array<{ id: string; attachments: Array<{ id: string }> }>;
  assert.deepEqual(
    archivedList.find((item) => item.id === managerPhoto.id)?.attachments,
    [],
  );

  assert.equal(
    (await fetch(fileUrl(privateFile.id), { headers: { Cookie: managerCookie } }))
      .status,
    403,
  );
  assert.equal(
    (await fetch(fileUrl(sharedFile.id), { headers: { Cookie: managerCookie } }))
      .status,
    200,
  );

  const restoreResponse = await fetch(`${photoUrl(managerPhoto.id)}/restore`, {
    method: 'POST',
    headers: { Cookie: managerCookie },
  });
  assert.equal(restoreResponse.status, 201);
  const restored = (await restoreResponse.json()) as {
    deletedAt: string | null;
    restoredAt: string | null;
    restoredBy: { id: string } | null;
    attachments: Array<{ id: string }>;
  };
  assert.equal(restored.deletedAt, null);
  assert.ok(restored.restoredAt);
  assert.equal(restored.restoredBy?.id, manager.id);
  assert.deepEqual(
    restored.attachments.map((item) => item.id).sort(),
    [privateFile.id, sharedFile.id].sort(),
  );
  assert.equal(
    (await fetch(fileUrl(privateFile.id), { headers: { Cookie: managerCookie } }))
      .status,
    200,
  );
  assert.equal(
    (
      await fetch(`${photoUrl(managerPhoto.id)}/restore`, {
        method: 'POST',
        headers: { Cookie: managerCookie },
      })
    ).status,
    201,
  );

  assert.equal(
    (
      await fetch(photoUrl(creatorManagedPhoto.id), {
        method: 'DELETE',
        headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(photoUrl(leadershipManagedPhoto.id), {
        method: 'DELETE',
        headers: { Cookie: directorCookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    ).status,
    200,
  );

  const auditActions = (
    await prisma.auditEvent.findMany({
      where: { entityType: 'one_time_order', entityId: order.id },
      select: { action: true },
    })
  ).map((item) => item.action);
  assert.equal(
    auditActions.filter((action) => action === 'one_time_order.photo_deleted')
      .length,
    3,
  );
  assert.equal(
    auditActions.filter((action) => action === 'one_time_order.photo_restored')
      .length,
    1,
  );
});
