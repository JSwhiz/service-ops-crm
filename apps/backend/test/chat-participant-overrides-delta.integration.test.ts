import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { ChatRealtimeService, type NotificationRealtimeEvent } from '../src/modules/chats/chat-realtime.service';
import type { ChatSearchResponseDto } from '../src/modules/chats/dto/chat-search-response.dto';
import type { ChatRoomParticipantResponseDto, ChatRoomResponseDto } from '../src/modules/chats/dto/chat-response.dto';
import { createTestApp } from './helpers/create-test-app';
import { loginAndGetCookieHeader } from './helpers/auth';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// Delta only: preserves unknown-source fail-closed policy and exact hidden-room refusal.
test('chat participant overrides delta: exclusion consumers and manual leadership-room membership only', async t => {
  // New standalone isolated schema, no seven accepted subtests or their dependent state.
  const evidenceDirectory = mkdtempSync(join(tmpdir(), 'chat-overrides-delta2-'));
  const rawReplies: Array<{ route: string; method: string; actor: string; request: unknown; status: number; body: string }> = [];
  const executedSources = [
    'src/common/access/notification-access.ts', 'src/common/access/notification-source-visibility.ts',
    'src/common/access/notification-chat-visibility.ts', 'src/modules/chats/chats.service.ts',
    'src/modules/chats/chat-realtime.service.ts', 'src/modules/chats/utils/chat-membership.util.ts',
    'src/modules/files/files.service.ts', 'test/chat-participant-overrides-delta.integration.test.ts',
  ].map(path => {
    const data = readFileSync(resolve(path)); const target = join(evidenceDirectory, 'source', path);
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, data);
    return { path, sha256: createHash('sha256').update(data).digest('hex') };
  });
  writeFileSync(join(evidenceDirectory, 'executed-source.json'), JSON.stringify(executedSources, null, 2));
  t.after(() => {
    const raw = JSON.stringify(rawReplies, null, 2); const path = join(evidenceDirectory, 'raw-replies.json'); writeFileSync(path, raw);
    t.diagnostic(JSON.stringify({ rawReplies: path, sha256: createHash('sha256').update(raw).digest('hex'), sourceManifest: join(evidenceDirectory, 'executed-source.json') }));
  });
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const databaseURL = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseURL.hostname));
  assert.match(databaseURL.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const db = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => { try { await app.close(); } finally { await db.$disconnect(); } });
  const [founder, manager, hr] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    db.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    db.user.findUniqueOrThrow({ where: { login: 'hr1' } }),
  ]);
  const [adminCookie, managerCookie, hrCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' }),
    loginAndGetCookieHeader({ baseUrl, login: manager.login, password: 'manager123' }),
    loginAndGetCookieHeader({ baseUrl, login: hr.login, password: 'hr123' }),
  ]);
  const request = async (route: string, method = 'GET', body?: unknown, cookie = adminCookie): Promise<Response> => {
    const response = await fetch(`${baseUrl}/api/v1${route}`, {
      method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    rawReplies.push({ route, method, actor: cookie === adminCookie ? founder.id : cookie === managerCookie ? manager.id : hr.id,
      request: body ?? null, status: response.status, body: await response.clone().text() });
    return response;
  };
  const ok = async <T>(route: string, method = 'GET', body?: unknown, cookie = adminCookie): Promise<T> => {
    const response = await request(route, method, body, cookie);
    assert.equal(response.ok, true, `${method} ${route}: ${response.status} ${await response.clone().text()}`);
    return response.json() as Promise<T>;
  };
  const room = await ok<ChatRoomResponseDto>('/chats/rooms/code/objects');
  const roomPath = `/chats/rooms/${room.id}`;
  assert.equal(room.capabilities.canManageMembers, true);
  const baselineRoles = await db.userRole.findMany({ where: { userId: hr.id }, orderBy: { roleId: 'asc' } });

  await t.test('new exclusion immediately gates existing file metadata/content, search and stored/queued notifications', async () => {
    // Metadata-only private attachment fixture: no upload/preview/storage replay.
    await ok('/chats/rooms/code/objects', 'GET', undefined, managerCookie);
    const marker = `override-private-${randomUUID()}`;
    const message = await db.chatMessage.create({ data: { chatRoomId: room.id, messageType: 'user', authorUserId: founder.id, text: marker } });
    const file = await db.file.create({ data: { bucket: 'integration-unused-metadata-only', objectKey: `participant-override/${randomUUID()}`, originalName: `${marker}.txt`, mimeType: 'text/plain', sizeBytes: 1, uploadedByUserId: founder.id } });
    await db.fileAttachment.create({ data: { fileId: file.id, entityType: 'chat_message', entityId: message.id, uploadedByUserId: founder.id } });
    const control = await ok<ChatRoomResponseDto>('/chats/rooms/group', 'POST', { title: `Independent override control ${randomUUID()}`, participantUserIds: [manager.id] });
    const notice = await db.notification.create({ data: { recipientUserId: manager.id, type: 'chat.message_received', title: marker, body: marker, entityType: 'chat_room', entityId: room.id } });
    const legacyNotice = await db.notification.create({ data: { recipientUserId: manager.id, type: 'chat.message_received', title: marker, entityType: 'chat_message', entityId: message.id } });
    const controlNotice = await db.notification.create({ data: { recipientUserId: manager.id, type: 'chat.room_created', title: 'Independent B', entityType: 'chat_room', entityId: control.id } });
    const event: NotificationRealtimeEvent = { type: 'notification.created', recipientUserIds: [manager.id], payload: {
      id: notice.id, type: notice.type, title: notice.title, body: notice.body, entityType: notice.entityType, entityId: notice.entityId, targetUrl: notice.targetUrl, readAt: null, createdAt: notice.createdAt.toISOString(),
    } };
    // Invoke the actual queued-delivery ACL gate against current DB state; this
    // is not represented as a physical WebSocket delivery assertion.
    const delivery = app.get(ChatRealtimeService) as unknown as { canDeliver(userId: string, event: NotificationRealtimeEvent): Promise<boolean> };
    assert.equal((await request(`/files/${file.id}`, 'GET', undefined, managerCookie)).status, 200);
    assert.equal((await ok<ChatSearchResponseDto>(`/chats/search?q=${encodeURIComponent(marker)}`, 'GET', undefined, managerCookie)).messages.some(value => value.id === message.id), true);
    const beforeNotices = await ok<{ items: Array<{ id: string }> }>('/notifications?page=1&limit=100', 'GET', undefined, managerCookie);
    assert.equal(beforeNotices.items.some(value => value.id === notice.id), true);
    // Unknown chat_message sources intentionally fail closed; never make this a positive grant.
    assert.equal(beforeNotices.items.some(value => value.id === legacyNotice.id), false);
    assert.equal(beforeNotices.items.some(value => value.id === controlNotice.id), true);
    assert.equal(await delivery.canDeliver(manager.id, event), true);
    const beforeExclusion = await db.file.findUniqueOrThrow({ where: { id: file.id } });
    await ok(roomPath + `/participants/${manager.id}`, 'DELETE');
    const afterExclusion = await db.file.findUniqueOrThrow({ where: { id: file.id } });
    assert.deepEqual(afterExclusion, beforeExclusion);
    assert.equal((await request(`/files/${file.id}`, 'GET', undefined, managerCookie)).status, 403);
    // Authorization must reject before attempting to read the deliberately absent binary.
    assert.equal((await request(`/files/${file.id}/content`, 'GET', undefined, managerCookie)).status, 403);
    const search = await ok<ChatSearchResponseDto>(`/chats/search?q=${encodeURIComponent(marker)}`, 'GET', undefined, managerCookie);
    assert.equal(search.messages.some(value => value.id === message.id), false);
    const afterNotices = await ok<{ items: Array<{ id: string }> }>('/notifications?page=1&limit=100', 'GET', undefined, managerCookie);
    assert.equal(afterNotices.items.some(value => value.id === notice.id || value.id === legacyNotice.id), false);
    assert.equal(afterNotices.items.some(value => value.id === controlNotice.id), true);
    assert.equal(await delivery.canDeliver(manager.id, event), false);
    assert.deepEqual(await db.file.findUniqueOrThrow({ where: { id: file.id } }), afterExclusion);
    assert.equal((await db.notification.findUniqueOrThrow({ where: { id: notice.id } })).readAt, null);
    await ok(roomPath + `/participants/${manager.id}/automatic`, 'POST');
  });

  await t.test('manual non-leadership member of leadership-only room gains only explicit room membership', async () => {
    const leadership = await ok<ChatRoomResponseDto>('/chats/rooms/code/leadership');
    const hiddenLeadership = async (): Promise<void> => {
      const hidden = await request('/chats/rooms/code/leadership', 'GET', undefined, hrCookie);
      assert.equal(hidden.status, 404);
      const error = await hidden.json() as { statusCode: number; error: { message: string; statusCode: number } };
      assert.equal(error.statusCode, 404);
      assert.equal(error.error.statusCode, 404);
      assert.equal(error.error.message, 'Chat room not found');
      const messages = await request(`/chats/rooms/${leadership.id}/messages`, 'GET', undefined, hrCookie);
      assert.equal(messages.status, 403);
      assert.equal((await messages.json() as { error: { message: string } }).error.message, 'Chat room access denied');
    };
    await hiddenLeadership();
    await ok(`/chats/rooms/${leadership.id}/participants`, 'POST', { userIds: [hr.id] });
    const admitted = await ok<ChatRoomResponseDto>('/chats/rooms/code/leadership', 'GET', undefined, hrCookie);
    assert.equal(admitted.id, leadership.id);
    assert.equal(admitted.capabilities.canManageMembers, false);
    assert.equal((await ok<ChatRoomParticipantResponseDto[]>(`/chats/rooms/${leadership.id}/participants`)).find(value => value.user.id === hr.id)?.membershipSource, 'manual');
    assert.deepEqual(await db.userRole.findMany({ where: { userId: hr.id }, orderBy: { roleId: 'asc' } }), baselineRoles);
    await ok(`/chats/rooms/${leadership.id}/participants/${hr.id}`, 'DELETE');
    await hiddenLeadership();
    await ok(`/chats/rooms/${leadership.id}/participants/${hr.id}/automatic`, 'POST');
    await hiddenLeadership();
  });

});
