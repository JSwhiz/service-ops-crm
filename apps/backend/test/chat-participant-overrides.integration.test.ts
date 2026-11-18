import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { ChatRealtimeService, type NotificationRealtimeEvent } from '../src/modules/chats/chat-realtime.service';
import type { ChatSearchResponseDto } from '../src/modules/chats/dto/chat-search-response.dto';
import type { ChatRoomParticipantResponseDto, ChatRoomResponseDto, ChatMessageResponseDto } from '../src/modules/chats/dto/chat-response.dto';
import { createTestApp } from './helpers/create-test-app';
import { loginAndGetCookieHeader } from './helpers/auth';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// New manual-override cohort only. Run once with the isolated integration runner;
// no accepted chat suite, storage bytes, production fixtures or external sockets.
test('leadership group/system participant overrides are durable and do not bypass room/source ACL', async t => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const databaseURL = new URL(process.env.DATABASE_URL!);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseURL.hostname));
  assert.match(databaseURL.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const db = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => { try { await app.close(); } finally { await db.$disconnect(); } });
  const [founder, manager, hr, managerRole, hrRole] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { login: 'founder' } }),
    db.user.findUniqueOrThrow({ where: { login: 'manager1' } }),
    db.user.findUniqueOrThrow({ where: { login: 'hr1' } }),
    db.role.findUniqueOrThrow({ where: { code: 'manager' } }),
    db.role.findUniqueOrThrow({ where: { code: 'hr' } }),
  ]);
  const [adminCookie, managerCookie, hrCookie] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' }),
    loginAndGetCookieHeader({ baseUrl, login: manager.login, password: 'manager123' }),
    loginAndGetCookieHeader({ baseUrl, login: hr.login, password: 'hr123' }),
  ]);
  const request = (route: string, method = 'GET', body?: unknown, cookie = adminCookie) => fetch(`${baseUrl}/api/v1${route}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const ok = async <T>(route: string, method = 'GET', body?: unknown, cookie = adminCookie): Promise<T> => {
    const response = await request(route, method, body, cookie);
    assert.equal(response.ok, true, `${method} ${route}: ${response.status} ${await response.clone().text()}`);
    return response.json() as Promise<T>;
  };
  const room = await ok<ChatRoomResponseDto>('/chats/rooms/code/objects');
  const roomPath = `/chats/rooms/${room.id}`;
  const roster = () => ok<ChatRoomParticipantResponseDto[]>(`${roomPath}/participants`);
  const override = (id: string) => db.chatRoomParticipant.findUniqueOrThrow({ where: { chatRoomId_userId: { chatRoomId: room.id, userId: id } } });
  const snapshot = async () => ({
    participants: await db.chatRoomParticipant.findMany({ where: { chatRoomId: room.id }, orderBy: { id: 'asc' } }),
    audit: await db.auditEvent.findMany({ where: { entityType: 'chat_room', entityId: room.id }, orderBy: { id: 'asc' } }),
  });
  assert.equal(room.capabilities.canManageMembers, true);
  const baselineRoles = await db.userRole.findMany({ where: { userId: hr.id }, orderBy: { roleId: 'asc' } });
  const baselineAssignments = await db.objectAssignment.findMany({ where: { userId: hr.id }, orderBy: { id: 'asc' } });

  await t.test('automatic roster includes eligible users before their first room read; manual adds preserve provenance and roles', async () => {
    assert.equal((await roster()).find(person => person.user.id === manager.id)?.membershipSource, 'automatic');
    assert.equal((await request(roomPath + '/participants', 'POST', { userIds: [hr.id] }, managerCookie)).status, 403);
    await ok(roomPath + '/participants', 'POST', { userIds: [hr.id] });
    assert.equal((await roster()).find(person => person.user.id === hr.id)?.membershipSource, 'manual');
    assert.equal((await request(roomPath + '/messages', 'GET', undefined, hrCookie)).status, 200);
    assert.deepEqual(await db.userRole.findMany({ where: { userId: hr.id }, orderBy: { roleId: 'asc' } }), baselineRoles);
    assert.deepEqual(await db.objectAssignment.findMany({ where: { userId: hr.id }, orderBy: { id: 'asc' } }), baselineAssignments);
    const original = await override(hr.id);
    const before = await snapshot();
    await ok(roomPath + '/participants', 'POST', { userIds: [hr.id, hr.id] });
    assert.deepEqual(await snapshot(), before);
    assert.equal((await override(hr.id)).joinedAt.getTime(), original.joinedAt.getTime());
  });

  await t.test('durable exclusion survives GET initialization, role changes and additive read grant; restore automatic is audited', async () => {
    await ok(roomPath + `/participants/${manager.id}`, 'DELETE');
    const state = await override(manager.id);
    assert.equal(state.membershipOverride, 'exclude');
    assert.equal((await request(roomPath + '/messages', 'GET', undefined, managerCookie)).status, 403);
    assert.equal((await request(roomPath + '/participants', 'GET', undefined, managerCookie)).status, 403);
    const list = await ok<ChatRoomResponseDto[]>('/chats/rooms', 'GET', undefined, managerCookie);
    assert.equal(list.some(value => value.id === room.id), false);
    assert.equal((await override(manager.id)).membershipOverride, 'exclude');
    const allow = await db.userAccessRule.create({ data: { userId: manager.id, actionCode: 'chat.read', effect: 'allow', scope: 'selected', selectedIds: [room.id] } });
    try { assert.equal((await request(roomPath + '/messages', 'GET', undefined, managerCookie)).status, 403); }
    finally { await db.userAccessRule.delete({ where: { id: allow.id } }); }
    await db.userRole.deleteMany({ where: { userId: manager.id, roleId: managerRole.id } });
    await db.userRole.create({ data: { userId: manager.id, roleId: hrRole.id } });
    assert.equal((await request(roomPath + '/messages', 'GET', undefined, managerCookie)).status, 403);
    await db.userRole.deleteMany({ where: { userId: manager.id, roleId: hrRole.id } });
    await db.userRole.create({ data: { userId: manager.id, roleId: managerRole.id } });
    assert.equal((await request(roomPath + '/messages', 'GET', undefined, managerCookie)).status, 403);
    const excluded = (await roster()).find(value => value.user.id === manager.id)!;
    assert.equal(excluded.membershipSource, 'excluded');
    assert.equal(excluded.canRestoreAutomatic, true);
    const beforeRepeat = await snapshot();
    await ok(roomPath + `/participants/${manager.id}`, 'DELETE');
    assert.deepEqual(await snapshot(), beforeRepeat);
    await ok(roomPath + `/participants/${manager.id}/automatic`, 'POST');
    assert.equal((await override(manager.id)).membershipOverride, null);
    assert.equal((await request(roomPath + '/messages', 'GET', undefined, managerCookie)).status, 200);
    assert.equal((await roster()).find(value => value.user.id === manager.id)?.membershipSource, 'automatic');
    assert.equal(await db.auditEvent.count({ where: { entityType: 'chat_room', entityId: room.id, actorUserId: founder.id, action: 'chat.room.participant_automatic_restored' } }), 1);
  });

  await t.test('restore automatic removes a manual-only admission and never fabricates automatic eligibility', async () => {
    await ok(roomPath + `/participants/${hr.id}/automatic`, 'POST');
    assert.equal((await override(hr.id)).membershipOverride, null);
    assert.equal((await request(roomPath + '/messages', 'GET', undefined, hrCookie)).status, 403);
    await ok(roomPath + '/participants', 'POST', { userIds: [hr.id] });
  });

  await t.test('leadership personal room read deny overrides membership administration with no write', async () => {
    const rule = await db.userAccessRule.create({ data: { userId: founder.id, actionCode: 'chat.read', effect: 'deny', scope: 'selected', selectedIds: [room.id] } });
    const before = await snapshot();
    try {
      assert.equal((await request(roomPath + '/participants', 'POST', { userIds: [manager.id] })).status, 403);
      assert.deepEqual(await snapshot(), before);
    } finally { await db.userAccessRule.delete({ where: { id: rule.id } }); }
  });

  await t.test('manual room inclusion leaves source read deny effective for published messages', async () => {
    const object = await db.object.create({ data: { name: `participant-source-${randomUUID()}`, address: 'Local source fixture', status: 'active', createdByUserId: founder.id, paymentType: 'daily', dailyRate: 0, monthlySalary: 0 } });
    const marker = `private-participant-source-${randomUUID()}`;
    const source = await db.chatMessage.create({ data: { chatRoomId: room.id, messageType: 'system', text: marker, metadata: { objectId: object.id } } });
    const control = await db.chatMessage.create({ data: { chatRoomId: room.id, messageType: 'system', text: 'Independent room-only control' } });
    const deny = await db.userAccessRule.create({ data: { userId: hr.id, actionCode: 'objects.read', effect: 'deny', scope: 'selected', selectedIds: [object.id] } });
    try {
      const messages = await ok<ChatMessageResponseDto[]>(roomPath + '/messages', 'GET', undefined, hrCookie);
      assert.equal(messages.some(message => message.id === source.id), false);
      assert.equal(messages.some(message => message.id === control.id), true);
      assert.equal((await override(hr.id)).membershipOverride, 'include');
    } finally { await db.userAccessRule.delete({ where: { id: deny.id } }); }
  });

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
    // Unsupported chat_message sources remain hidden under the generic fail-closed policy.
    assert.equal(beforeNotices.items.some(value => value.id === legacyNotice.id), false);
    assert.equal(await delivery.canDeliver(manager.id, event), true);
    await ok(roomPath + `/participants/${manager.id}`, 'DELETE');
    const afterExclusion = await db.file.findUniqueOrThrow({ where: { id: file.id } });
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
      const reply = await hidden.json() as { statusCode: number; error: { statusCode: number; message: string } };
      assert.equal(reply.statusCode, 404);
      assert.equal(reply.error.statusCode, 404);
      assert.equal(reply.error.message, 'Chat room not found');
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

  await t.test('unjoined leadership administers roster only, never messages, files or search', async () => {
    const peer = await db.user.findUniqueOrThrow({ where: { login: 'manager2' } });
    const group = await db.chatRoom.create({ data: { title: `Unjoined management ${randomUUID()}`, roomType: 'group', visibilityType: 'explicit_members', createdByUserId: manager.id,
      participants: { create: { userId: manager.id, roleInRoom: 'admin', joinedAt: new Date(0), lastReadAt: new Date() } } } });
    const marker = `unjoined-private-${randomUUID()}`;
    const message = await db.chatMessage.create({ data: { chatRoomId: group.id, authorUserId: manager.id, messageType: 'user', text: marker } });
    const file = await db.file.create({ data: { bucket: 'integration-unused-metadata-only', objectKey: `unjoined/${randomUUID()}`, originalName: 'private.txt', mimeType: 'text/plain', sizeBytes: 1, uploadedByUserId: manager.id } });
    await db.fileAttachment.create({ data: { fileId: file.id, entityType: 'chat_message', entityId: message.id, uploadedByUserId: manager.id } });
    const list = await ok<{ items: Array<{ id: string; title: string; roomType: string; visibilityType: string }> }>('/chats/rooms/management');
    const entry = list.items.find(value => value.id === group.id)!;
    assert.ok(entry);
    assert.deepEqual(Object.keys(entry).sort(), ['id', 'roomType', 'title', 'visibilityType']);
    const rows = await ok<ChatRoomParticipantResponseDto[]>(`/chats/rooms/${group.id}/participants`);
    assert.equal(rows[0].lastReadAt, null); // Management is not a read-receipts grant.
    assert.equal((await request(`/chats/rooms/${group.id}/messages`)).status, 403);
    assert.equal((await request(`/files/${file.id}`)).status, 403);
    const ack = await ok<{ outcome: string }>(`/chats/rooms/${group.id}/participants`, 'POST', { userIds: [peer.id] });
    assert.deepEqual(ack, { outcome: 'saved_without_access' });
    assert.equal(await db.chatRoomParticipant.count({ where: { chatRoomId: group.id, userId: founder.id } }), 0);
    assert.equal((await request(`/chats/rooms/${group.id}/messages`)).status, 403);
    assert.equal((await request(`/files/${file.id}`)).status, 403);
    assert.equal((await ok<ChatSearchResponseDto>(`/chats/search?q=${encodeURIComponent(marker)}`)).messages.some(value => value.id === message.id), false);
    assert.equal((await ok<ChatRoomParticipantResponseDto[]>(`/chats/rooms/${group.id}/participants`)).some(value => value.user.id === peer.id), true);
    await ok(`/chats/rooms/${group.id}/participants/${peer.id}`, 'DELETE');
    const deny = await db.userAccessRule.create({ data: { userId: founder.id, actionCode: 'chat.read', effect: 'deny', scope: 'selected', selectedIds: [group.id] } });
    const before = await db.chatRoomParticipant.findMany({ where: { chatRoomId: group.id }, orderBy: { id: 'asc' } });
    try {
      assert.equal((await ok<{ items: Array<{ id: string }> }>('/chats/rooms/management')).items.some(value => value.id === group.id), false);
      assert.equal((await request(`/chats/rooms/${group.id}/participants`)).status, 403);
      assert.equal((await request(`/chats/rooms/${group.id}/participants`, 'POST', { userIds: [peer.id] })).status, 403);
      assert.deepEqual(await db.chatRoomParticipant.findMany({ where: { chatRoomId: group.id }, orderBy: { id: 'asc' } }), before);
    } finally { await db.userAccessRule.delete({ where: { id: deny.id } }); }
  });

  await t.test('group management retains explicit admin roles and direct conversations stay two-party', async () => {
    const group = await ok<ChatRoomResponseDto>('/chats/rooms/group', 'POST', { title: `New override cohort ${randomUUID()}`, participantUserIds: [manager.id] });
    await ok(`/chats/rooms/${group.id}/participants`, 'POST', { userIds: [founder.id, hr.id] });
    const owner = await db.chatRoomParticipant.findUniqueOrThrow({ where: { chatRoomId_userId: { chatRoomId: group.id, userId: founder.id } } });
    assert.equal(owner.roleInRoom, 'admin');
    assert.equal((await ok<ChatRoomParticipantResponseDto[]>(`/chats/rooms/${group.id}/participants`)).some(value => value.user.id === hr.id), true);
    const direct = await ok<ChatRoomResponseDto>('/chats/rooms/direct', 'POST', { targetUserId: manager.id });
    assert.equal(direct.capabilities.canManageMembers, false);
    const before = await db.chatRoomParticipant.findMany({ where: { chatRoomId: direct.id }, orderBy: { id: 'asc' } });
    assert.equal(before.length, 2);
    assert.equal((await request(`/chats/rooms/${direct.id}/participants`, 'POST', { userIds: [hr.id] })).status, 403);
    assert.equal((await request(`/chats/rooms/${direct.id}/participants/${manager.id}`, 'DELETE')).status, 403);
    assert.deepEqual(await db.chatRoomParticipant.findMany({ where: { chatRoomId: direct.id }, orderBy: { id: 'asc' } }), before);
  });
});
