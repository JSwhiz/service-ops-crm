import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';

import { ChatRealtimeService, type ChatRealtimeEvent } from '../src/modules/chats/chat-realtime.service';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';

test('personal member management does not grant room administration, history reset or unrelated room access', async (t) => {
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true');
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => { await app.close(); await prisma.$disconnect(); });
  const users = await prisma.user.findMany({ where: { login: { in: ['founder', 'stepanova', 'manager1', 'manager2', 'kireeva'] } } });
  const id = (login: string): string => users.find((user) => user.login === login)!.id;
  // Isolate the personal grant from this seeded user's unrelated admin role.
  const managerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
  await prisma.userRole.deleteMany({ where: { userId: id('stepanova') } });
  await prisma.userRole.create({ data: { userId: id('stepanova'), roleId: managerRole.id } });
  const permission = await prisma.permission.upsert({ where: { code: 'chat.room.manage_members' }, update: {}, create: { code: 'chat.room.manage_members', name: 'Управление участниками групповых чатов' } });
  await prisma.userPermission.upsert({ where: { userId_permissionId: { userId: id('stepanova'), permissionId: permission.id } }, update: {}, create: { userId: id('stepanova'), permissionId: permission.id } });
  const [founder, member, ordinary] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'stepanova', password: 'stepanova123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'manager1', password: 'manager123' }),
  ]);
  const request = (cookie: string, path: string, method = 'GET', body?: unknown): Promise<Response> => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const create = await request(founder, '/chats/rooms/group', 'POST', { title: 'Membership fixture', participantUserIds: [id('stepanova'), id('manager1')] });
  assert.equal(create.status, 201);
  const room = (await create.json()) as { id: string };
  const rooms = await request(member, '/chats/rooms');
  const grantedRoom = ((await rooms.json()) as Array<{ id: string; capabilities: { canManage: boolean; canManageMembers: boolean } }>).find((entry) => entry.id === room.id)!;
  assert.equal(grantedRoom.capabilities.canManageMembers, true);
  assert.equal(grantedRoom.capabilities.canManage, false);
  assert.equal((await request(member, `/chats/rooms/${room.id}`, 'PATCH', { title: 'Denied rename' })).status, 403);
  assert.equal((await request(ordinary, `/chats/rooms/${room.id}/participants`, 'POST', { userIds: [id('manager2')] })).status, 403);
  assert.equal((await request(member, `/chats/rooms/${room.id}/participants`, 'POST', { userIds: [id('manager2')] })).status, 201);
  const founderMembership = await prisma.chatRoomParticipant.findUniqueOrThrow({ where: { chatRoomId_userId: { chatRoomId: room.id, userId: id('founder') } } });
  assert.equal((await request(member, `/chats/rooms/${room.id}/participants`, 'POST', { userIds: [id('founder')] })).status, 201);
  const unchanged = await prisma.chatRoomParticipant.findUniqueOrThrow({ where: { id: founderMembership.id } });
  assert.equal(unchanged.roleInRoom, 'admin');
  assert.equal(unchanged.joinedAt.toISOString(), founderMembership.joinedAt.toISOString());
  assert.equal((await request(ordinary, `/chats/rooms/${room.id}/participants/${id('manager2')}`, 'DELETE')).status, 403);
  assert.equal((await request(member, `/chats/rooms/${room.id}/participants/${id('manager2')}`, 'DELETE')).status, 200);
  const removed = await prisma.chatRoomParticipant.findUniqueOrThrow({ where: { chatRoomId_userId: { chatRoomId: room.id, userId: id('manager2') } } });
  assert.ok(removed.leftAt);
  const manager2 = await loginAndGetCookieHeader({ baseUrl, login: 'manager2', password: 'manager123' });
  assert.equal((await request(manager2, `/chats/rooms/${room.id}/messages`)).status, 403);
  assert.equal((await request(member, `/chats/rooms/${room.id}/participants`, 'POST', { userIds: [id('manager2')] })).status, 201);
  const rejoined = await prisma.chatRoomParticipant.findUniqueOrThrow({ where: { id: removed.id } });
  assert.equal(rejoined.leftAt, null);
  assert.ok(rejoined.joinedAt > removed.joinedAt);
  const unrelated = await request(founder, '/chats/rooms/group', 'POST', { title: 'Unrelated', participantUserIds: [id('manager1')] });
  const unrelatedRoom = (await unrelated.json()) as { id: string };
  assert.equal((await request(member, `/chats/rooms/${unrelatedRoom.id}/participants`, 'POST', { userIds: [id('kireeva')] })).status, 403);
  const audit = await prisma.auditEvent.findMany({ where: { entityType: 'chat_room', entityId: room.id, actorUserId: id('stepanova') } });
  assert.equal(audit.filter((entry) => entry.action === 'chat.room.participants_added').length, 2);
  assert.equal(audit.filter((entry) => entry.action === 'chat.room.participant_removed').length, 1);
  await prisma.userPermission.delete({ where: { userId_permissionId: { userId: id('stepanova'), permissionId: permission.id } } });
  const revoked = await loginAndGetCookieHeader({ baseUrl, login: 'stepanova', password: 'stepanova123' });
  assert.equal((await request(revoked, `/chats/rooms/${room.id}/participants`, 'POST', { userIds: [id('kireeva')] })).status, 403);
});

test('operation_manager cannot read the objects system chat or receive its messages even with an object assignment', async (t) => {
  assert.equal(process.env.TEST_ISOLATED_DATABASE, 'true');
  const prisma = new PrismaClient();
  const { app, baseUrl } = await createTestApp();
  t.after(async () => { await app.close(); await prisma.$disconnect(); });
  const user = await prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'operation_manager' } });
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } });
  const object = await prisma.object.findFirstOrThrow({ where: { deletedAt: null } });
  await prisma.objectAssignment.upsert({ where: { objectId_userId_assignmentRoleCode: { objectId: object.id, userId: user.id, assignmentRoleCode: 'manager' } }, update: { isActive: true }, create: { objectId: object.id, userId: user.id, assignmentRoleCode: 'manager', isActive: true } });
  const [cookie, founder] = await Promise.all([
    loginAndGetCookieHeader({ baseUrl, login: 'manager2', password: 'manager123' }),
    loginAndGetCookieHeader({ baseUrl, login: 'founder', password: 'founder123' }),
  ]);
  const events: ChatRealtimeEvent[] = [];
  app.get(ChatRealtimeService).publish = async (event: ChatRealtimeEvent): Promise<void> => { events.push(event); };
  const room = await prisma.chatRoom.findUniqueOrThrow({ where: { code: 'objects' } });
  const list = await fetch(`${baseUrl}/api/v1/chats/rooms`, { headers: { Cookie: cookie } });
  const rooms = (await list.json()) as Array<{ code: string }>;
  assert.ok(!rooms.some((entry) => entry.code === 'objects'));
  assert.ok(!rooms.some((entry) => entry.code === 'leadership'));
  assert.ok(rooms.some((entry) => entry.code === 'one_time_orders'));
  for (const path of [`/chats/rooms/code/objects`, `/chats/rooms/${room.id}/messages`, `/chats/rooms/${room.id}/participants`]) {
    const response = await fetch(`${baseUrl}/api/v1${path}`, { headers: { Cookie: cookie } });
    assert.ok([403, 404].includes(response.status), `${path}: ${response.status}`);
  }
  const hiddenSearch = await fetch(`${baseUrl}/api/v1/chats/search?q=report&roomId=${room.id}`, { headers: { Cookie: cookie } });
  assert.equal(hiddenSearch.status, 200);
  assert.deepEqual(await hiddenSearch.json(), { rooms: [], messages: [], nextCursor: null });
  const message = await fetch(`${baseUrl}/api/v1/chats/rooms/${room.id}/messages`, { method: 'POST', headers: { Cookie: founder, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Private report notification fixture' }) });
  assert.equal(message.status, 201);
  const created = (await message.json()) as { id: string };
  const directMessage = await fetch(`${baseUrl}/api/v1/chats/messages/${created.id}`, { headers: { Cookie: cookie } });
  assert.equal(directMessage.status, 403);
  assert.ok(events.some((event) => event.type === 'chat.message_created'));
  assert.ok(events.every((event) => !event.recipientUserIds.includes(user.id)));
  assert.equal(await prisma.notification.count({ where: { recipientUserId: user.id, entityId: created.id } }), 0);
  const founderRooms = await fetch(`${baseUrl}/api/v1/chats/rooms`, { headers: { Cookie: founder } });
  assert.ok(((await founderRooms.json()) as Array<{ code: string }>).some((entry) => entry.code === 'leadership'));
});
