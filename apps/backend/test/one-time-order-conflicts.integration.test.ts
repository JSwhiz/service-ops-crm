import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

interface ConflictResponse {
  hasConflicts: boolean;
  conflicts: Array<{
    date: string;
    user: { id: string };
    type: string;
    relatedOrder?: { id: string };
  }>;
}

test('one-time order schedule conflicts require an explicit override', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `order-conflicts-${Date.now()}`;
  const [founder, managerOne, managerTwo] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } }),
  ]);
  const existingOrder = await prisma.oneTimeOrder.create({
    data: {
      title: `${marker}-existing`,
      executionAddress: 'Москва',
      status: 'planned',
      executionStartDate: new Date('2040-04-10T00:00:00.000Z'),
      executionEndDate: new Date('2040-04-12T00:00:00.000Z'),
      contactName: 'Контакт',
      createdByUserId: founder.id,
      assignments: {
        create: {
          userId: managerOne.id,
          assignmentRoleCode: 'one_time_manager',
          isActive: true,
        },
      },
    },
  });
  const updateTarget = await prisma.oneTimeOrder.create({
    data: {
      title: `${marker}-update`,
      executionAddress: 'Москва',
      status: 'planned',
      executionStartDate: new Date('2040-04-20T00:00:00.000Z'),
      executionEndDate: new Date('2040-04-20T00:00:00.000Z'),
      contactName: 'Контакт',
      createdByUserId: founder.id,
      assignments: {
        create: {
          userId: managerOne.id,
          assignmentRoleCode: 'one_time_manager',
          isActive: true,
        },
      },
    },
  });
  const assignmentTarget = await prisma.oneTimeOrder.create({
    data: {
      title: `${marker}-assignment`,
      executionAddress: 'Москва',
      status: 'planned',
      executionStartDate: new Date('2040-04-11T00:00:00.000Z'),
      executionEndDate: new Date('2040-04-11T00:00:00.000Z'),
      contactName: 'Контакт',
      createdByUserId: founder.id,
    },
  });
  const cancelledTarget = await prisma.oneTimeOrder.create({
    data: {
      title: `${marker}-cancelled`,
      executionAddress: 'Москва',
      status: 'cancelled',
      executionStartDate: new Date('2040-04-11T00:00:00.000Z'),
      executionEndDate: new Date('2040-04-11T00:00:00.000Z'),
      contactName: 'Контакт',
      createdByUserId: founder.id,
      assignments: {
        create: {
          userId: managerOne.id,
          assignmentRoleCode: 'one_time_manager',
          isActive: true,
        },
      },
    },
  });
  const availabilityEntries = await Promise.all([
    prisma.oneTimeManagerAvailability.create({
      data: {
        userId: managerOne.id,
        entryType: 'vacation',
        startDate: new Date('2040-04-11T00:00:00.000Z'),
        endDate: new Date('2040-04-11T00:00:00.000Z'),
        status: 'approved',
        requestedByUserId: founder.id,
        resolvedByUserId: founder.id,
        resolvedAt: new Date(),
      },
    }),
    prisma.oneTimeManagerAvailability.create({
      data: {
        userId: managerTwo.id,
        entryType: 'sick_leave',
        startDate: new Date('2040-04-11T00:00:00.000Z'),
        endDate: new Date('2040-04-11T00:00:00.000Z'),
        status: 'pending',
        requestedByUserId: managerTwo.id,
      },
    }),
  ]);

  const cleanup = async () => {
    await prisma.oneTimeManagerAvailability.deleteMany({
      where: { id: { in: availabilityEntries.map((entry) => entry.id) } },
    });
    const orders = await prisma.oneTimeOrder.findMany({
      where: { title: { startsWith: marker } },
      select: { id: true },
    });
    const orderIds = orders.map((order) => order.id);
    await prisma.auditEvent.deleteMany({
      where: { entityType: 'one_time_order', entityId: { in: orderIds } },
    });
    await prisma.oneTimeOrder.deleteMany({ where: { id: { in: orderIds } } });
  };

  t.after(async () => {
    await cleanup();
    await app.close();
    await prisma.$disconnect();
  });

  const [founderCookie, managerCookie] = await Promise.all([
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
  ]);
  const jsonRequest = (path: string, method: string, cookie: string, body: unknown) =>
    fetch(`${baseUrl}/api/v1/one-time-orders${path}`, {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const checkConflicts = async (cookie: string, body: unknown) => {
    const response = await jsonRequest(
      '/calendar/check-conflicts',
      'POST',
      cookie,
      body,
    );
    assert.equal(response.status, 201);
    return (await response.json()) as ConflictResponse;
  };

  const leadershipCheck = await checkConflicts(founderCookie, {
    executionStartDate: '2040-04-11',
    executionEndDate: '2040-04-11',
    managerUserIds: [managerOne.id, managerTwo.id],
  });
  assert.equal(leadershipCheck.hasConflicts, true);
  assert.ok(
    leadershipCheck.conflicts.some(
      (conflict) =>
        conflict.type === 'existing_order' &&
        conflict.relatedOrder?.id === existingOrder.id,
    ),
  );
  assert.ok(
    leadershipCheck.conflicts.some(
      (conflict) => conflict.type === 'vacation' && conflict.user.id === managerOne.id,
    ),
  );
  assert.ok(
    leadershipCheck.conflicts.some(
      (conflict) =>
        conflict.type === 'pending_availability_request' &&
        conflict.user.id === managerTwo.id,
    ),
  );

  const ordinaryCheck = await checkConflicts(managerCookie, {
    executionStartDate: '2040-04-11',
    executionEndDate: '2040-04-11',
    managerUserIds: [managerOne.id, managerTwo.id],
  });
  assert.equal(
    ordinaryCheck.conflicts.some(
      (conflict) => conflict.type === 'pending_availability_request',
    ),
    false,
  );

  const pendingOnly = await checkConflicts(founderCookie, {
    executionStartDate: '2040-04-11',
    executionEndDate: '2040-04-11',
    managerUserIds: [managerTwo.id],
  });
  assert.equal(pendingOnly.hasConflicts, false);
  assert.deepEqual(
    pendingOnly.conflicts.map((conflict) => conflict.type),
    ['pending_availability_request'],
  );

  const createPayload = {
    title: `${marker}-created`,
    executionAddress: 'Москва',
    executionStartDate: '2040-04-11',
    executionEndDate: '2040-04-11',
    contactName: 'Контакт',
    managerUserIds: [managerOne.id],
  };
  const blockedCreate = await jsonRequest('', 'POST', founderCookie, createPayload);
  assert.equal(blockedCreate.status, 409);
  const blockedCreateBody = (await blockedCreate.json()) as {
    error: ConflictResponse;
  };
  assert.equal(blockedCreateBody.error.hasConflicts, true);
  assert.equal(
    await prisma.oneTimeOrder.count({ where: { title: createPayload.title } }),
    0,
  );

  const confirmedCreate = await jsonRequest('', 'POST', founderCookie, {
    ...createPayload,
    confirmScheduleConflicts: true,
  });
  assert.equal(confirmedCreate.status, 201);
  const created = (await confirmedCreate.json()) as { id: string };
  assert.ok(
    await prisma.auditEvent.findFirst({
      where: {
        entityType: 'one_time_order',
        entityId: created.id,
        action: 'one_time_order.schedule_conflict_overridden',
      },
    }),
  );

  const blockedUpdate = await jsonRequest(
    `/${updateTarget.id}`,
    'PATCH',
    founderCookie,
    {
      executionStartDate: '2040-04-11',
      executionEndDate: '2040-04-11',
    },
  );
  assert.equal(blockedUpdate.status, 409);
  assert.equal(
    (
      await prisma.oneTimeOrder.findUniqueOrThrow({ where: { id: updateTarget.id } })
    ).executionStartDate?.toISOString().slice(0, 10),
    '2040-04-20',
  );
  const confirmedUpdate = await jsonRequest(
    `/${updateTarget.id}`,
    'PATCH',
    founderCookie,
    {
      executionStartDate: '2040-04-11',
      executionEndDate: '2040-04-11',
      confirmScheduleConflicts: true,
    },
  );
  assert.equal(confirmedUpdate.status, 200);

  const blockedAssignment = await jsonRequest(
    `/${assignmentTarget.id}/managers`,
    'POST',
    founderCookie,
    { userId: managerOne.id },
  );
  assert.equal(blockedAssignment.status, 409);
  assert.equal(
    await prisma.oneTimeOrderAssignment.count({
      where: { oneTimeOrderId: assignmentTarget.id, userId: managerOne.id },
    }),
    0,
  );
  const confirmedAssignment = await jsonRequest(
    `/${assignmentTarget.id}/managers`,
    'POST',
    founderCookie,
    { userId: managerOne.id, confirmScheduleConflicts: true },
  );
  assert.equal(confirmedAssignment.status, 201);

  const blockedActivation = await jsonRequest(
    `/${cancelledTarget.id}/status`,
    'PATCH',
    founderCookie,
    { status: 'planned' },
  );
  assert.equal(blockedActivation.status, 409);
  assert.equal(
    (await prisma.oneTimeOrder.findUniqueOrThrow({ where: { id: cancelledTarget.id } }))
      .status,
    'cancelled',
  );
  const confirmedActivation = await jsonRequest(
    `/${cancelledTarget.id}/status`,
    'PATCH',
    founderCookie,
    { status: 'planned', confirmScheduleConflicts: true },
  );
  assert.equal(confirmedActivation.status, 200);
});
