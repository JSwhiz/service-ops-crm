import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/modules/auth/utils/password-hash.util';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface RegistryItem {
  id: string;
  title: string;
  accessibleTaskCount: number;
  reviewPreview: string | null;
  specificationProgress: { completed: number; total: number };
  capabilities: Record<string, boolean>;
  agreedSum?: number;
  financialNotes?: string;
  expenseNotes?: string;
}

interface RegistryResponse {
  items: RegistryItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

test('one-time order registry is paginated, searchable and access-safe', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `order-registry-${Date.now()}`;
  const [founder, manager, reader] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } }),
  ]);
  const object = await prisma.object.create({
    data: {
      name: `${marker}-object-search`,
      address: 'Москва',
      status: 'active',
      createdByUserId: founder.id,
    },
  });
  const firstOrder = await prisma.oneTimeOrder.create({
    data: {
      title: `${marker}-alpha`,
      executionAddress: `${marker}-address`,
      executionStartDate: new Date('2026-07-10T00:00:00.000Z'),
      executionEndDate: new Date('2026-07-15T00:00:00.000Z'),
      status: 'in_progress',
      contactName: `${marker}-contact`,
      contactPhone: `+7-${Date.now()}`,
      reviewText: `${marker}-review-search`,
      reviewRating: 5,
      agreedSum: 250000,
      financialNotes: 'private finance',
      expenseNotes: 'private expense',
      linkedObjectId: object.id,
      createdByUserId: founder.id,
      assignments: {
        create: [manager.id, reader.id].map((userId) => ({
          userId,
          assignmentRoleCode: 'one_time_manager',
          isActive: true,
        })),
      },
      specificationItems: {
        create: [
          {
            title: `${marker}-spec-complete`,
            sortOrder: 0,
            isCompleted: true,
            createdByUserId: founder.id,
          },
          {
            title: `${marker}-spec-open`,
            sortOrder: 1,
            createdByUserId: founder.id,
          },
          {
            title: `${marker}-spec-deleted`,
            sortOrder: 2,
            deletedAt: new Date(),
            deletedByUserId: founder.id,
            createdByUserId: founder.id,
          },
        ],
      },
    },
  });
  const secondOrder = await prisma.oneTimeOrder.create({
    data: {
      title: `${marker}-beta`,
      executionAddress: 'Санкт-Петербург',
      executionStartDate: new Date('2026-07-20T00:00:00.000Z'),
      executionEndDate: new Date('2026-07-22T00:00:00.000Z'),
      status: 'completed',
      contactName: 'Второй контакт',
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
  const thirdOrder = await prisma.oneTimeOrder.create({
    data: {
      title: `${marker}-gamma`,
      executionAddress: 'Казань',
      status: 'new',
      contactName: 'Третий контакт',
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
  const inactiveAssignmentOrder = await prisma.oneTimeOrder.create({
    data: {
      title: `${marker}-inactive-assignment`,
      executionAddress: 'Тула',
      status: 'planned',
      contactName: 'Скрытый контакт',
      createdByUserId: founder.id,
      assignments: {
        create: {
          userId: reader.id,
          assignmentRoleCode: 'one_time_manager',
          isActive: false,
        },
      },
    },
  });
  const hiddenComment = await prisma.oneTimeOrderComment.create({
    data: {
      oneTimeOrderId: inactiveAssignmentOrder.id,
      content: 'Скрытый комментарий',
      createdByUserId: founder.id,
    },
  });
  const hiddenFiles = await Promise.all([
    prisma.file.create({
      data: {
        bucket: 'test-private',
        objectKey: `${marker}/order.txt`,
        originalName: 'order.txt',
        mimeType: 'text/plain',
        sizeBytes: 5,
        uploadedByUserId: founder.id,
        attachments: {
          create: {
            entityType: 'one_time_order',
            entityId: inactiveAssignmentOrder.id,
            uploadedByUserId: founder.id,
          },
        },
      },
    }),
    prisma.file.create({
      data: {
        bucket: 'test-private',
        objectKey: `${marker}/comment.txt`,
        originalName: 'comment.txt',
        mimeType: 'text/plain',
        sizeBytes: 7,
        uploadedByUserId: founder.id,
        attachments: {
          create: {
            entityType: 'one_time_order_comment',
            entityId: hiddenComment.id,
            uploadedByUserId: founder.id,
          },
        },
      },
    }),
  ]);
  const tasks = await Promise.all(
    [manager.id, reader.id].map((userId, index) =>
      prisma.task.create({
        data: {
          title: `${marker}-task-${index}`,
          priority: 'important_not_urgent',
          status: 'new',
          oneTimeOrderId: firstOrder.id,
          createdByUserId: founder.id,
          visibilityMode: 'selected',
          assignees: { create: { userId } },
          visibilityUsers: {
            create: { userId, addedByUserId: founder.id },
          },
        },
      }),
    ),
  );

  t.after(async () => {
    await prisma.task.deleteMany({ where: { id: { in: tasks.map((task) => task.id) } } });
    await prisma.file.deleteMany({
      where: { id: { in: hiddenFiles.map((file) => file.id) } },
    });
    await prisma.oneTimeOrder.deleteMany({
      where: {
        id: {
          in: [
            firstOrder.id,
            secondOrder.id,
            thirdOrder.id,
            inactiveAssignmentOrder.id,
          ],
        },
      },
    });
    await prisma.object.delete({ where: { id: object.id } });
    await app.close();
    await prisma.$disconnect();
  });

  const [founderCookie, readerCookie, deputyCookie] = await Promise.all([
    loginAndGetCookieHeader({
      baseUrl,
      login: 'founder',
      password: 'founder123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: 'manager2',
      password: 'manager123',
    }),
    loginAndGetCookieHeader({
      baseUrl,
      login: 'deputy1',
      password: 'deputy123',
    }),
  ]);
  const list = async (query: string, cookie = founderCookie) => {
    const response = await fetch(`${baseUrl}/api/v1/one-time-orders?${query}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    return (await response.json()) as RegistryResponse;
  };

  const firstPage = await list(`q=${marker}&page=1&limit=1&sortBy=title&sortDirection=asc`);
  assert.equal(firstPage.page, 1);
  assert.equal(firstPage.limit, 1);
  assert.equal(firstPage.total, 4);
  assert.equal(firstPage.totalPages, 4);
  assert.equal(firstPage.items[0]?.id, firstOrder.id);

  const overlap = await list(
    `q=${marker}&dateFrom=2026-07-15&dateTo=2026-07-20&limit=20`,
  );
  assert.deepEqual(
    new Set(overlap.items.map((item) => item.id)),
    new Set([firstOrder.id, secondOrder.id]),
  );

  for (const search of [
    `${marker}-object-search`,
    reader.login,
    `${marker}-review-search`,
    firstOrder.contactPhone!,
  ]) {
    const searchResult = await list(`q=${encodeURIComponent(search)}&limit=20`);
    assert.ok(searchResult.items.some((item) => item.id === firstOrder.id));
  }

  const filtered = await list(
    `managerUserId=${reader.id}&linkedObjectId=${object.id}&status=in_progress`,
  );
  assert.deepEqual(filtered.items.map((item) => item.id), [firstOrder.id]);
  const founderItem = filtered.items[0]!;
  assert.deepEqual(founderItem.specificationProgress, { completed: 1, total: 2 });
  assert.equal(founderItem.accessibleTaskCount, 2);
  assert.equal(founderItem.reviewPreview, `${marker}-review-search`);
  assert.equal(founderItem.agreedSum, undefined);
  assert.equal(founderItem.financialNotes, undefined);
  assert.equal(founderItem.expenseNotes, undefined);
  assert.equal(typeof founderItem.capabilities.canEdit, 'boolean');

  const readerResult = await list(`q=${marker}&limit=20`, readerCookie);
  assert.deepEqual(readerResult.items.map((item) => item.id), [firstOrder.id]);
  assert.equal(readerResult.total, readerResult.items.length);
  assert.equal(readerResult.items[0]?.accessibleTaskCount, 1);

  const deputyResult = await list(`q=${marker}&limit=20`, deputyCookie);
  assert.deepEqual(deputyResult.items, []);
  assert.equal(deputyResult.total, 0);

  for (const hiddenFile of hiddenFiles) {
    const fileResponse = await fetch(
      `${baseUrl}/api/v1/files/${hiddenFile.id}`,
      { headers: { Cookie: deputyCookie } },
    );
    assert.equal(fileResponse.status, 403);
  }
});

test('one-time order visibility matrix protects cards and child resources', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `order-security-${Date.now()}`;
  const [founder, hr, managerA, managerB, managerRole] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'hr1' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'manager' } }),
  ]);
  const object = await prisma.object.create({
    data: {
      name: `${marker}-object`,
      address: 'Москва',
      status: 'active',
      createdByUserId: founder.id,
    },
  });
  const makeOrder = (input: {
    suffix: string;
    createdByUserId?: string;
    managerUserId?: string;
    assignmentActive?: boolean;
    status?: string;
    linkedObjectId?: string;
  }) =>
    prisma.oneTimeOrder.create({
      data: {
        title: `${marker}-${input.suffix}`,
        executionAddress: 'Москва',
        status: input.status ?? 'planned',
        executionStartDate: new Date('2052-03-10T00:00:00.000Z'),
        executionEndDate: new Date('2052-03-10T00:00:00.000Z'),
        contactName: 'Контакт',
        createdByUserId: input.createdByUserId ?? founder.id,
        linkedObjectId: input.linkedObjectId,
        assignments: input.managerUserId
          ? {
              create: {
                userId: input.managerUserId,
                assignmentRoleCode: 'one_time_manager',
                isActive: input.assignmentActive ?? true,
              },
            }
          : undefined,
      },
    });
  const orders = await Promise.all([
    makeOrder({ suffix: 'manager-a', managerUserId: managerA.id, linkedObjectId: object.id }),
    makeOrder({ suffix: 'manager-b', managerUserId: managerB.id }),
    makeOrder({ suffix: 'leadership-only' }),
    makeOrder({ suffix: 'cancelled', managerUserId: managerA.id, status: 'cancelled' }),
    makeOrder({ suffix: 'inactive-assignment', managerUserId: managerA.id, assignmentActive: false }),
    makeOrder({ suffix: 'hr-created', createdByUserId: hr.id }),
  ]);
  const [managerAOrder, managerBOrder, leadershipOrder, cancelledOrder, inactiveOrder, hrOrder] =
    orders;
  const hiddenFile = await prisma.file.create({
    data: {
      bucket: 'integration-test',
      objectKey: `${marker}/hidden.txt`,
      originalName: 'hidden.txt',
      mimeType: 'text/plain',
      sizeBytes: 10,
      uploadedByUserId: founder.id,
      attachments: {
        create: {
          entityType: 'one_time_order',
          entityId: managerBOrder!.id,
          uploadedByUserId: founder.id,
        },
      },
    },
  });
  await prisma.auditEvent.create({
    data: {
      entityType: 'one_time_order',
      entityId: managerBOrder!.id,
      actorUserId: founder.id,
      action: 'one_time_order.security_fixture',
    },
  });
  const inactiveUser = await prisma.user.create({
    data: {
      login: `${marker}-inactive`,
      fullName: 'Неактивный менеджер',
      passwordHash: await hashPassword('inactive123'),
      isActive: false,
      roles: { create: { roleId: managerRole.id } },
    },
  });

  t.after(async () => {
    await prisma.file.delete({ where: { id: hiddenFile.id } });
    await prisma.auditEvent.deleteMany({
      where: { entityType: 'one_time_order', entityId: managerBOrder!.id },
    });
    await prisma.oneTimeOrder.deleteMany({
      where: { id: { in: orders.map((order) => order.id) } },
    });
    await prisma.object.delete({ where: { id: object.id } });
    await prisma.user.delete({ where: { id: inactiveUser.id } });
    await app.close();
    await prisma.$disconnect();
  });

  const [founderCookie, directorCookie, deputyCookie, hrCookie, managerACookie, managerBCookie] =
    await Promise.all([
      loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' }),
      loginAndGetCookieHeader({ baseUrl, login: 'director', password: 'director123' }),
      loginAndGetCookieHeader({ baseUrl, login: 'deputy1', password: 'deputy123' }),
      loginAndGetCookieHeader({ baseUrl, login: 'hr1', password: 'hr123' }),
      loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
      loginAndGetCookieHeader({ baseUrl, login: 'manager2', password: 'manager123' }),
    ]);
  const visibleIds = async (cookie: string) => {
    const response = await fetch(
      `${baseUrl}/api/v1/one-time-orders?q=${marker}&limit=20`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as RegistryResponse;
    assert.equal(payload.total, payload.items.length);
    return new Set(payload.items.map((item) => item.id));
  };

  assert.deepEqual(await visibleIds(founderCookie), new Set(orders.map((order) => order.id)));
  assert.deepEqual(await visibleIds(directorCookie), new Set(orders.map((order) => order.id)));
  assert.deepEqual(await visibleIds(deputyCookie), new Set());
  assert.deepEqual(await visibleIds(hrCookie), new Set([hrOrder!.id]));
  assert.deepEqual(
    await visibleIds(managerACookie),
    new Set([managerAOrder!.id, cancelledOrder!.id]),
  );
  assert.deepEqual(await visibleIds(managerBCookie), new Set([managerBOrder!.id]));
  assert.ok(!(await visibleIds(managerACookie)).has(inactiveOrder!.id));
  assert.ok((await visibleIds(founderCookie)).has(leadershipOrder!.id));

  for (const path of [
    '',
    '/comments',
    '/photos',
    '/specification-items',
    '/tasks',
    '/history',
  ]) {
    const response = await fetch(
      `${baseUrl}/api/v1/one-time-orders/${managerBOrder!.id}${path}`,
      { headers: { Cookie: managerACookie } },
    );
    assert.equal(response.status, 404);
  }
  const hiddenFileResponse = await fetch(
    `${baseUrl}/api/v1/files/${hiddenFile.id}`,
    { headers: { Cookie: managerACookie } },
  );
  assert.equal(hiddenFileResponse.status, 403);

  const inactiveLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: inactiveUser.login, password: 'inactive123' }),
  });
  assert.equal(inactiveLogin.status, 401);
});
