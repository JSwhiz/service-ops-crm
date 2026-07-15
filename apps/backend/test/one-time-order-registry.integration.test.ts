import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

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
    await prisma.oneTimeOrder.deleteMany({
      where: { id: { in: [firstOrder.id, secondOrder.id, thirdOrder.id] } },
    });
    await prisma.object.delete({ where: { id: object.id } });
    await app.close();
    await prisma.$disconnect();
  });

  const [founderCookie, readerCookie] = await Promise.all([
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
  assert.equal(firstPage.total, 3);
  assert.equal(firstPage.totalPages, 3);
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
  assert.equal(readerResult.items[0]?.accessibleTaskCount, 1);
});
