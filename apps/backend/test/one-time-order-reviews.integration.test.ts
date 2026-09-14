import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('review-only permission exposes reviews without order details or edit access', async (t) => {
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  const marker = `review-registry-${Date.now()}`;
  const [founder, managerOne, managerTwo, hr] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'hr1' } }),
  ]);
  const orders = await Promise.all([
    prisma.oneTimeOrder.create({
      data: {
        title: `${marker}-one`,
        executionAddress: `${marker}-secret-address-one`,
        status: 'completed',
        executionStartDate: new Date('2045-05-10T00:00:00.000Z'),
        executionEndDate: new Date('2045-05-11T00:00:00.000Z'),
        contactName: `${marker}-secret-contact-one`,
        contactPhone: '+79990000001',
        agreedSum: 125000,
        financialNotes: `${marker}-secret-finance-one`,
        reviewRating: 5,
        reviewText: `${marker}-review-one`,
        reviewUpdatedAt: new Date(),
        createdByUserId: founder.id,
        assignments: { create: { userId: managerOne.id, assignmentRoleCode: 'one_time_manager', isActive: true } },
      },
    }),
    prisma.oneTimeOrder.create({
      data: {
        title: `${marker}-two`,
        executionAddress: `${marker}-secret-address-two`,
        status: 'completed',
        executionStartDate: new Date('2045-05-12T00:00:00.000Z'),
        executionEndDate: new Date('2045-05-12T00:00:00.000Z'),
        contactName: `${marker}-secret-contact-two`,
        contactPhone: '+79990000002',
        agreedSum: 85000,
        financialNotes: `${marker}-secret-finance-two`,
        reviewRating: 4,
        reviewText: `${marker}-review-two`,
        reviewUpdatedAt: new Date(),
        createdByUserId: founder.id,
        assignments: { create: { userId: managerTwo.id, assignmentRoleCode: 'one_time_manager', isActive: true } },
      },
    }),
  ]);
  let reviewOnlyPermissionId: string | null = null;
  let directPermissionId: string | null = null;

  t.after(async () => {
    if (directPermissionId) {
      await prisma.userPermission.delete({ where: { id: directPermissionId } });
    }
    if (reviewOnlyPermissionId) {
      await prisma.userPermission.delete({ where: { id: reviewOnlyPermissionId } });
    }
    await prisma.oneTimeOrder.deleteMany({ where: { id: { in: orders.map(({ id }) => id) } } });
    await app.close();
    await prisma.$disconnect();
  });

  const reviewViewAllPermission = await prisma.permission.findUniqueOrThrow({
    where: { code: 'one_time_order.review.view_all' },
  });
  const reviewOnlyPermission = await prisma.userPermission.create({
    data: { userId: hr.id, permissionId: reviewViewAllPermission.id },
  });
  reviewOnlyPermissionId = reviewOnlyPermission.id;

  const [reviewOnlyCookie, managerCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'hr1', password: 'hr123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
  ]);
  const reviewOnlyMeResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
    headers: { Cookie: reviewOnlyCookie },
  });
  assert.equal(reviewOnlyMeResponse.status, 200);
  const reviewOnlyMe = await reviewOnlyMeResponse.json() as {
    capabilities: {
      canViewAllOneTimeOrderReviews: boolean;
      canAccessOneTimeOrders: boolean;
    };
  };
  assert.equal(reviewOnlyMe.capabilities.canViewAllOneTimeOrderReviews, true);
  assert.equal(reviewOnlyMe.capabilities.canAccessOneTimeOrders, false);

  const reviewResponse = await fetch(`${baseUrl}/api/v1/one-time-orders/reviews?limit=100&q=${marker}`, { headers: { Cookie: reviewOnlyCookie } });
  assert.equal(reviewResponse.status, 200);
  const reviewRaw = await reviewResponse.text();
  const reviewBody = JSON.parse(reviewRaw) as { items: Array<{ id: string; reviewText: string }> };
  assert.deepEqual(new Set(reviewBody.items.map(({ id }) => id)), new Set(orders.map(({ id }) => id)));
  assert.match(reviewRaw, new RegExp(`${marker}-review-one`));
  for (const secret of ['secret-address', 'secret-contact', 'secret-finance', '+799900000']) {
    assert.equal(reviewRaw.includes(secret), false);
  }

  const hiddenCard = await fetch(`${baseUrl}/api/v1/one-time-orders/${orders[0]!.id}`, { headers: { Cookie: reviewOnlyCookie } });
  assert.equal(hiddenCard.status, 404);
  const hiddenEdit = await fetch(`${baseUrl}/api/v1/one-time-orders/${orders[0]!.id}/review`, {
    method: 'PATCH', headers: { Cookie: reviewOnlyCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewRating: 1 }),
  });
  assert.equal(hiddenEdit.status, 404);

  const denied = await fetch(`${baseUrl}/api/v1/one-time-orders/reviews`, { headers: { Cookie: managerCookie } });
  assert.equal(denied.status, 403);

  const directPermission = await prisma.userPermission.create({
    data: { userId: managerOne.id, permissionId: reviewViewAllPermission.id },
  });
  directPermissionId = directPermission.id;
  const permittedManagerCookie = await loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' });
  const permitted = await fetch(`${baseUrl}/api/v1/one-time-orders/reviews?limit=100&q=${marker}`, { headers: { Cookie: permittedManagerCookie } });
  assert.equal(permitted.status, 200);
  const permittedBody = await permitted.json() as { items: Array<{ id: string }> };
  assert.equal(permittedBody.items.length, 2);

  const deputyPermissions = await prisma.rolePermission.findMany({
    where: { role: { code: 'deputy_director' } },
    select: { permission: { select: { code: true } } },
  });
  const codes = deputyPermissions.map(({ permission }) => permission.code);
  assert.equal(codes.includes('one_time_order.review.edit'), true);
  assert.equal(codes.includes('one_time_order.manage_all'), true);
});
