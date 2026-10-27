import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('read notifications can be permanently hidden by their recipient without deleting shared events or changing unread items', async (t) => {
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true');
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => { await app.close(); await prisma.$disconnect(); });
  const [owner, colleague] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } }),
  ]);
  const [cookie, colleagueCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager2', password: 'manager123' }),
  ]);
  const readAt = new Date('2026-10-20T10:00:00Z');
  const create = (recipientUserId: string, read: boolean) => prisma.notification.create({ data: {
    recipientUserId, type: 'object.created', title: 'Объект создан', entityType: 'object', entityId: 'object-link-fixture', readAt: read ? readAt : null,
  } });
  const [read, unread, other] = await Promise.all([create(owner.id, true), create(owner.id, false), create(colleague.id, true)]);
  const request = (auth: string, path: string, method = 'POST'): Promise<Response> => fetch(`${baseUrl}/api/v1/notifications${path}`, { method, headers: { Cookie: auth } });
  assert.equal((await request(cookie, `/${unread.id}/dismiss`)).status, 400);
  assert.equal((await request(colleagueCookie, `/${read.id}/dismiss`)).status, 404);
  assert.equal((await request(cookie, `/${other.id}/dismiss`)).status, 404);
  const beforeUnread = await request(cookie, '/unread-count', 'GET');
  const beforeCount = (await beforeUnread.json()) as { count: number };
  assert.equal((await request(cookie, `/${read.id}/dismiss`)).status, 201);
  assert.equal((await request(cookie, `/${read.id}/dismiss`)).status, 201);
  const stored = await prisma.notification.findUniqueOrThrow({ where: { id: read.id } });
  assert.ok(stored.dismissedAt);
  assert.equal(stored.readAt?.toISOString(), readAt.toISOString());
  const untouched = await prisma.notification.findUniqueOrThrow({ where: { id: other.id } });
  assert.equal(untouched.dismissedAt, null);
  const afterUnread = await request(cookie, '/unread-count', 'GET');
  assert.deepEqual(await afterUnread.json(), beforeCount);
  const listResponse = await request(cookie, '?limit=100&page=1', 'GET');
  assert.equal(listResponse.status, 200);
  const list = (await listResponse.json()) as { items: Array<{ id: string; targetUrl: string }>; total: number };
  assert.ok(!list.items.some((item) => item.id === read.id || item.id === other.id));
  assert.equal(list.items.find((item) => item.id === unread.id)?.targetUrl, '/objects/object-link-fixture');
  assert.equal((await request(cookie, `/${read.id}/read`)).status, 404);
  assert.equal((await request(cookie, '/read-all')).status, 201);
  const ownUnread = await prisma.notification.findUniqueOrThrow({ where: { id: unread.id } });
  assert.ok(ownUnread.readAt);
  assert.equal(ownUnread.dismissedAt, null);
  assert.equal((await request(cookie, `/${unread.id}/dismiss`)).status, 201);
  const finalList = await request(cookie, '?limit=100&page=1', 'GET');
  assert.ok(!((await finalList.json()) as { items: Array<{ id: string }> }).items.some((item) => item.id === unread.id));
  assert.equal(await prisma.notification.count({ where: { id: { in: [read.id, unread.id, other.id] } } }), 3);
});
