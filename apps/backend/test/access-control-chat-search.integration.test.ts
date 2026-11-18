import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { ChatSearchResponseDto } from '../src/modules/chats/dto/chat-search-response.dto';

import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('chat search and direct messages respect room-scoped denies in the existing session', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  assert.match(new URL(process.env.DATABASE_URL!).searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  t.after(() => prisma.$disconnect());
  const { app, baseUrl } = await createTestApp();
  t.after(() => app.close());
  const [template, role, founder] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'manager' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
  ]);
  const marker = `acl-chat-search-${randomUUID()}`;
  const secret = `Private message ${randomUUID()}`;
  const reader = await prisma.user.create({ data: {
    login: marker, fullName: marker, passwordHash: template.passwordHash, isActive: true,
    roles: { create: { roleId: role.id } },
  } });
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: reader.login, password: 'manager123' });
  const rooms = await Promise.all(['restricted', 'control'].map((suffix) => prisma.chatRoom.create({ data: {
    title: `${marker}-${suffix}`, roomType: 'group', visibilityType: 'explicit_members', createdByUserId: founder.id,
    participants: { create: { userId: reader.id, joinedAt: new Date('2026-01-01T00:00:00Z') } },
  } })));
  const messages = await Promise.all(rooms.map((room, index) => prisma.chatMessage.create({ data: {
    chatRoomId: room.id, authorUserId: founder.id, messageType: 'text',
    text: `${marker} ${index === 0 ? secret : 'Allowed control text'}`,
  } })));
  const get = (path: string) => fetch(`${baseUrl}/api/v1${path}`, { headers: { Cookie: cookie } });
  const search = async (roomId?: string) => {
    const params = new URLSearchParams({ q: marker, ...(roomId ? { roomId } : {}) });
    const response = await get(`/chats/search?${params}`);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json() as Promise<ChatSearchResponseDto>;
  };
  const baseline = await search();
  assert.ok(baseline.messages.some((message) => message.id === messages[0].id));
  assert.ok(baseline.messages.some((message) => message.id === messages[1].id));

  for (const actionCode of ['chat.search', 'chat.messages.read', 'chat.read', 'chat.access']) {
    await t.test(`${actionCode} selected room deny excludes room/message/search cursor`, async () => {
      const deny = await prisma.userAccessRule.create({ data: {
        userId: reader.id, actionCode, effect: 'deny', scope: 'selected', selectedIds: [rooms[0].id],
      } });
      try {
        const result = await search();
        const evidence = `${actionCode}: ${JSON.stringify(result)}`;
        assert.equal(result.rooms.some((room) => room.id === rooms[0].id), false, evidence);
        assert.equal(result.messages.some((message) => message.roomId === rooms[0].id), false, evidence);
        assert.equal(JSON.stringify(result).includes(secret), false, evidence);
        assert.ok(result.messages.some((message) => message.id === messages[1].id), evidence);
        const restricted = await search(rooms[0].id);
        assert.deepEqual(restricted.messages, [], JSON.stringify(restricted));
        assert.deepEqual(restricted.rooms, [], JSON.stringify(restricted));
        const cursor = await get(`/chats/search?${new URLSearchParams({ q: marker, roomId: rooms[0].id, before: messages[0].id })}`);
        assert.equal(cursor.status, 400, `Denied-room cursor cannot be resolved: ${await cursor.clone().text()}`);
        const direct = await get(`/chats/messages/${messages[0].id}`);
        assert.equal(direct.status, actionCode === 'chat.search' ? 200 : 403,
          `Message read and search are distinct actions: ${await direct.clone().text()}`);
      } finally {
        await prisma.userAccessRule.delete({ where: { id: deny.id } });
      }
      const restored = await search(rooms[0].id);
      assert.ok(restored.messages.some((message) => message.id === messages[0].id), JSON.stringify(restored));
    });
  }
  await prisma.userAccessRule.create({ data: { userId: reader.id, actionCode: 'chat.search', effect: 'deny', scope: 'all' } });
  assert.equal((await get(`/chats/search?q=${encodeURIComponent(marker)}`)).status, 403);

  await t.test('stored chat.message_received notifications disappear after leaving a room with the old cookie', async () => {
    const notifications = await Promise.all(rooms.map((room) => prisma.notification.create({ data: {
      recipientUserId: reader.id, type: 'chat.message_received', title: 'New message',
      entityType: 'chat_room', entityId: room.id, targetUrl: `/chats?roomId=${room.id}`,
    } })));
    const before = await get('/notifications?limit=10');
    assert.equal(before.status, 200, await before.clone().text());
    const baseline = await before.json() as { total: number; items: Array<{ id: string }> };
    assert.equal(baseline.total, 2, JSON.stringify(baseline));
    assert.deepEqual(new Set(baseline.items.map((row) => row.id)), new Set(notifications.map((row) => row.id)));
    assert.deepEqual(await (await get('/notifications/unread-count')).json(), { count: 2 });
    const leave = await fetch(`${baseUrl}/api/v1/chats/rooms/${rooms[0].id}/leave`, {
      method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(leave.status, 201, await leave.clone().text());
    const after = await get('/notifications?page=1&limit=1');
    assert.equal(after.status, 200, await after.clone().text());
    const result = await after.json() as { total: number; items: Array<{ id: string }> };
    assert.deepEqual({ total: result.total, ids: result.items.map((row) => row.id) }, {
      total: 1, ids: [notifications[1].id],
    }, JSON.stringify(result));
    assert.deepEqual(await (await get('/notifications/unread-count')).json(), { count: 1 });
    const read = await fetch(`${baseUrl}/api/v1/notifications/${notifications[0].id}/read`, {
      method: 'POST', headers: { Cookie: cookie },
    });
    assert.equal(read.status, 404, await read.clone().text());
    const saved = await prisma.notification.findUniqueOrThrow({ where: { id: notifications[0].id } });
    assert.equal(saved.readAt, null);
    assert.equal(saved.dismissedAt, null);
    assert.equal((await get(`/chats/messages/${messages[0].id}`)).status, 403);
  });
});
