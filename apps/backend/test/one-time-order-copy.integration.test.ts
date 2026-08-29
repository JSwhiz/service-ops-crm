import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('one-time order copy is scoped, atomic and resets lifecycle data', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  const marker = `copy-order-${Date.now()}`;
  const [founder, managerOne, managerTwo, managerRole] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'manager' } }),
  ]);
  const inactiveManager = await prisma.user.create({
    data: {
      login: `${marker}-inactive`,
      fullName: 'Неактивный менеджер копии',
      isActive: false,
      roles: { create: { roleId: managerRole.id } },
    },
  });
  const source = await prisma.oneTimeOrder.create({
    data: {
      title: `${marker}-source`,
      executionAddress: 'Москва, исходный адрес',
      status: 'completed',
      description: 'Исходное описание',
      executionDate: new Date('2044-03-10T00:00:00.000Z'),
      executionStartDate: new Date('2044-03-10T00:00:00.000Z'),
      executionEndDate: new Date('2044-03-11T00:00:00.000Z'),
      contactName: 'Исходный контакт',
      contactPhone: '+79990000000',
      agreedSum: 25000,
      plannedPaymentMethod: 'cash',
      financialNotes: 'Финансовая заметка',
      expenseNotes: 'Расходная заметка',
      reviewText: 'Не копировать',
      reviewRating: 5,
      workCycle: 3,
      createdByUserId: founder.id,
      assignments: {
        create: [
          {
            userId: managerOne.id,
            assignmentRoleCode: 'one_time_manager',
            isActive: true,
          },
          {
            userId: inactiveManager.id,
            assignmentRoleCode: 'one_time_manager',
            isActive: true,
          },
        ],
      },
      specificationItems: {
        create: [
          {
            title: 'Активный пункт',
            sortOrder: 0,
            requiresAttachment: true,
            isCompleted: true,
            completedAt: new Date(),
            completedByUserId: founder.id,
            createdByUserId: founder.id,
          },
          {
            title: 'Удаленный пункт',
            sortOrder: 1,
            deletedAt: new Date(),
            deletedByUserId: founder.id,
            createdByUserId: founder.id,
          },
        ],
      },
      comments: {
        create: {
          content: 'Не копировать комментарий',
          createdByUserId: founder.id,
        },
      },
      photos: {
        create: {
          photoCategory: 'before',
          comment: 'Не копировать фото',
          createdByUserId: founder.id,
        },
      },
      completions: {
        create: {
          workCycle: 1,
          status: 'active',
          completedAt: new Date(),
          completedByUserId: founder.id,
        },
      },
    },
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

  const basePayload = {
    title: `Копия — ${source.title}`,
    executionAddress: source.executionAddress,
    description: source.description,
    executionStartDate: '2044-03-10',
    executionEndDate: '2044-03-11',
    contactName: source.contactName,
    contactPhone: source.contactPhone,
    agreedSum: source.agreedSum ?? undefined,
    plannedPaymentMethod: 'cash',
    financialNotes: source.financialNotes,
    expenseNotes: source.expenseNotes,
    managerUserIds: [managerOne.id, inactiveManager.id],
    specificationItems: [
      {
        title: 'Активный пункт',
        description: 'Можно отредактировать до создания',
        requiresAttachment: true,
      },
    ],
  };

  const assignedManagerCopy = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${source.id}/copy`,
    {
      method: 'POST',
      headers: { Cookie: managerOneCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(basePayload),
    },
  );
  assert.equal(assignedManagerCopy.status, 403);

  const hiddenSourceCopy = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${source.id}/copy`,
    {
      method: 'POST',
      headers: { Cookie: managerTwoCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(basePayload),
    },
  );
  assert.equal(hiddenSourceCopy.status, 404);

  const conflictCheck = await fetch(
    `${baseUrl}/api/v1/one-time-orders/calendar/check-conflicts`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        executionStartDate: '2044-03-10',
        executionEndDate: '2044-03-11',
        managerUserIds: [managerOne.id],
      }),
    },
  );
  assert.equal(conflictCheck.status, 201);
  const conflicts = (await conflictCheck.json()) as {
    hasConflicts: boolean;
    conflictFingerprint: string | null;
  };
  assert.equal(conflicts.hasConflicts, true);

  const unconfirmedCopy = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${source.id}/copy`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(basePayload),
    },
  );
  assert.equal(unconfirmedCopy.status, 409);

  const invalidCopyTitle = `${marker}-invalid-copy`;
  const invalidCopy = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${source.id}/copy`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...basePayload,
        title: invalidCopyTitle,
        specificationItems: [{ title: '' }],
      }),
    },
  );
  assert.equal(invalidCopy.status, 400);
  assert.equal(
    await prisma.oneTimeOrder.count({ where: { title: invalidCopyTitle } }),
    0,
  );

  const copyResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${source.id}/copy`,
    {
      method: 'POST',
      headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...basePayload,
        conflictFingerprint: conflicts.conflictFingerprint,
      }),
    },
  );
  assert.equal(copyResponse.status, 201);
  const copiedResponse = (await copyResponse.json()) as {
    id: string;
    status: string;
    workCycle: number;
    reviewText: string | null;
    reviewRating: number | null;
    managers: Array<{ userId: string }>;
  };
  assert.notEqual(copiedResponse.id, source.id);
  assert.equal(copiedResponse.status, 'new');
  assert.equal(copiedResponse.workCycle, 1);
  assert.equal(copiedResponse.reviewText, null);
  assert.equal(copiedResponse.reviewRating, null);
  assert.deepEqual(
    copiedResponse.managers.map((manager) => manager.userId),
    [managerOne.id],
  );

  const copied = await prisma.oneTimeOrder.findUniqueOrThrow({
    where: { id: copiedResponse.id },
    include: {
      specificationItems: true,
      completions: true,
      completionPayments: true,
      comments: true,
      dailyReports: true,
      photos: true,
      tasks: true,
      accountabilityFundings: true,
      accountabilityExpenses: true,
    },
  });
  assert.equal(copied.specificationItems.length, 1);
  assert.equal(copied.specificationItems[0]?.isCompleted, false);
  assert.equal(copied.specificationItems[0]?.completedAt, null);
  assert.equal(copied.completions.length, 0);
  assert.equal(copied.completionPayments.length, 0);
  assert.equal(copied.comments.length, 0);
  assert.equal(copied.dailyReports.length, 0);
  assert.equal(copied.photos.length, 0);
  assert.equal(copied.tasks.length, 0);
  assert.equal(copied.accountabilityFundings.length, 0);
  assert.equal(copied.accountabilityExpenses.length, 0);

  const audit = await prisma.auditEvent.findFirstOrThrow({
    where: {
      entityType: 'one_time_order',
      entityId: copied.id,
      action: 'one_time_order.copied',
    },
  });
  assert.match(JSON.stringify(audit.metadata), new RegExp(source.id));
});
