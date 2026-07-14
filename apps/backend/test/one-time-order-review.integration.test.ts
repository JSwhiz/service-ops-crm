import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('one-time order review uses permission, validation, audit and explicit clear', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const [founder, manager] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
  ]);
  const order = await prisma.oneTimeOrder.create({
    data: {
      title: `Review integration ${Date.now()}`,
      executionAddress: 'Москва',
      status: 'completed',
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
    await prisma.oneTimeOrderAssignment.deleteMany({
      where: { oneTimeOrderId: order.id },
    });
    await prisma.oneTimeOrder.delete({ where: { id: order.id } });
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
  const reviewUrl = `${baseUrl}/api/v1/one-time-orders/${order.id}/review`;

  const managerDenied = await fetch(reviewUrl, {
    method: 'PATCH',
    headers: { Cookie: managerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewRating: 5 }),
  });
  assert.equal(managerDenied.status, 403);

  for (const reviewRating of [0, 6]) {
    const invalidRating = await fetch(reviewUrl, {
      method: 'PATCH',
      headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewRating }),
    });
    assert.equal(invalidRating.status, 400);
  }

  const emptyReview = await fetch(reviewUrl, {
    method: 'PATCH',
    headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewText: '   ', reviewRating: null }),
  });
  assert.equal(emptyReview.status, 400);

  const updateResponse = await fetch(reviewUrl, {
    method: 'PATCH',
    headers: { Cookie: founderCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewText: '  Отличная работа  ', reviewRating: 5 }),
  });
  assert.equal(updateResponse.status, 200);
  const updated = (await updateResponse.json()) as {
    status: string;
    reviewText: string | null;
    reviewRating: number | null;
    reviewUpdatedAt: string | null;
    reviewUpdatedBy: { id: string } | null;
  };
  assert.equal(updated.status, 'completed');
  assert.equal(updated.reviewText, 'Отличная работа');
  assert.equal(updated.reviewRating, 5);
  assert.ok(updated.reviewUpdatedAt);
  assert.equal(updated.reviewUpdatedBy?.id, founder.id);

  const historyResponse = await fetch(
    `${baseUrl}/api/v1/one-time-orders/${order.id}/history`,
    { headers: { Cookie: founderCookie } },
  );
  assert.equal(historyResponse.status, 200);
  const history = (await historyResponse.json()) as Array<{
    action: string;
    oldValues: Record<string, unknown> | null;
    newValues: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
  }>;
  const updatedEvent = history.find(
    (item) => item.action === 'one_time_order.review_updated',
  );
  assert.equal(updatedEvent?.oldValues?.reviewRating, null);
  assert.equal(updatedEvent?.newValues?.reviewRating, 5);
  assert.equal(updatedEvent?.metadata?.actorUserId, founder.id);

  const clearResponse = await fetch(reviewUrl, {
    method: 'DELETE',
    headers: { Cookie: founderCookie },
  });
  assert.equal(clearResponse.status, 200);
  const cleared = (await clearResponse.json()) as {
    reviewText: string | null;
    reviewRating: number | null;
    reviewUpdatedAt: string | null;
    reviewUpdatedBy: unknown;
  };
  assert.equal(cleared.reviewText, null);
  assert.equal(cleared.reviewRating, null);
  assert.equal(cleared.reviewUpdatedAt, null);
  assert.equal(cleared.reviewUpdatedBy, null);

  const auditActions = (
    await prisma.auditEvent.findMany({
      where: { entityType: 'one_time_order', entityId: order.id },
      select: { action: true },
    })
  ).map((item) => item.action);
  assert.ok(auditActions.includes('one_time_order.review_updated'));
  assert.ok(auditActions.includes('one_time_order.review_cleared'));
});
