import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import type { ChatMessageResponseDto, ChatRoomResponseDto } from '../src/modules/chats/dto/chat-response.dto';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

// Text-only manual rooms in the runner's disposable schema. No attachments,
// external recipients, socket assertions, worker jobs or production fixtures.
test('personal chat grants preserve manual membership, authorship and selected-room boundaries with current cookies', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname));
  assert.equal(databaseUrl.port, '55432');
  assert.match(databaseUrl.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => {
    try { await closeApp?.(); } finally { await prisma.$disconnect(); }
  });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const [actor, peer, extra, founder] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { login: 'manager1' }, include: {
      roles: { include: { role: true } }, permissions: { include: { permission: true } },
    } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'manager2' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'kireeva' } }),
    prisma.user.findUniqueOrThrow({ where: { login: 'founder' } }),
  ]);
  assert.deepEqual(actor.roles.map(({ role }) => role.code), ['manager']);
  assert.equal(actor.permissions.some(({ permission }) => ['chat.room.manage_members', 'chat.room.close_global'].includes(permission.code)), false);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id } }), 0);
  // Neither subject refreshes its cookie when rules or membership change.
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const peerCookie = await loginAndGetCookieHeader({ baseUrl, login: peer.login, password: 'manager123' });
  const request = (path: string, method = 'GET', body?: unknown, auth = cookie): Promise<Response> => fetch(`${baseUrl}/api/v1/chats${path}`, {
    method, headers: { Cookie: auth, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const success = async <T>(path: string, method = 'GET', body?: unknown, status = 200, auth = cookie): Promise<T> => {
    const response = await request(path, method, body, auth);
    assert.equal(response.status, status, `${method} ${path}: ${await response.clone().text()}`);
    return response.json() as Promise<T>;
  };
  // Warm the legacy system-room memberships before any no-effects snapshots.
  await success('/rooms');
  const marker = `acl-chat-${randomUUID()}`;
  const rooms: Array<{ id: string }> = [];
  for (const label of ['A', 'B', 'hidden']) rooms.push(await prisma.chatRoom.create({ data: {
    title: `${marker}-${label}`, roomType: 'group', visibilityType: 'explicit_members', createdByUserId: founder.id,
    lastMessagePreview: `${marker}-preview-${label}`, lastMessageAt: new Date(),
    participants: { create: [
      { userId: founder.id, roleInRoom: 'admin', joinedAt: new Date('2026-01-01T00:00:00Z') },
      { userId: peer.id, roleInRoom: 'member', joinedAt: new Date('2026-01-01T00:00:00Z') },
      ...(label === 'hidden' ? [] : [{ userId: actor.id, roleInRoom: 'member', joinedAt: new Date('2026-01-01T00:00:00Z') }]),
    ] },
  } }));
  const [a, b, hidden] = rooms;
  const own = await Promise.all([a, b].map((room) => prisma.chatMessage.create({ data: {
    chatRoomId: room.id, authorUserId: actor.id, messageType: 'user', text: `${marker}-own-${room.id}`,
  } })));
  const foreign = await prisma.chatMessage.create({ data: {
    chatRoomId: a.id, authorUserId: peer.id, messageType: 'user', text: `${marker}-foreign`,
  } });
  const hiddenMessage = await prisma.chatMessage.create({ data: {
    chatRoomId: hidden.id, authorUserId: peer.id, messageType: 'user', text: `${marker}-secret`,
  } });
  const snapshot = async () => ({
    rooms: await prisma.chatRoom.findMany({ orderBy: { id: 'asc' } }),
    participants: await prisma.chatRoomParticipant.findMany({ orderBy: { id: 'asc' } }),
    messages: await prisma.chatMessage.findMany({ orderBy: { id: 'asc' } }),
    edits: await prisma.chatMessageEditHistory.findMany({ orderBy: { id: 'asc' } }),
    reactions: await prisma.chatMessageReaction.findMany({ orderBy: { id: 'asc' } }),
    attachments: await prisma.fileAttachment.findMany({ orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    audit: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
  });
  const denied = async (path: string, method = 'GET', body?: unknown, auth = cookie) => {
    const before = await snapshot();
    const response = await request(path, method, body, auth);
    assert.equal(response.status, 403, `${method} ${path}: ${await response.clone().text()}`);
    assert.deepEqual(await snapshot(), before, `${method} ${path} must have no stored effects`);
  };
  const withRule = async (actionCode: string, effect: 'allow' | 'deny', selectedIds: string[] | undefined, run: () => Promise<void>) => {
    // One persisted rule per user/action. Nested denies replace, then restore,
    // the outer grant; never fabricate simultaneous allow+deny rows.
    const previous = await prisma.userAccessRule.findUnique({ where: { userId_actionCode: { userId: actor.id, actionCode } } });
    const data = { effect, scope: selectedIds ? 'selected' : 'all', selectedIds: selectedIds ?? [] };
    if (previous) {
      await prisma.userAccessRule.update({ where: { id: previous.id }, data });
      try { await run(); } finally {
        await prisma.userAccessRule.update({ where: { id: previous.id }, data: {
          effect: previous.effect, scope: previous.scope, selectedIds: previous.selectedIds,
        } });
      }
      return;
    }
    const rule = await prisma.userAccessRule.create({ data: {
      userId: actor.id, actionCode, ...data,
    } });
    try { await run(); } finally { await prisma.userAccessRule.delete({ where: { id: rule.id } }); }
  };
  const roomDto = async (id: string) => {
    const list = await success<ChatRoomResponseDto[]>('/rooms');
    const dto = list.find((entry) => entry.id === id);
    assert.ok(dto, `Room ${id} should be listed`);
    return dto;
  };
  const audit = async (id: string, action: string, count = 1) => {
    assert.equal(await prisma.auditEvent.count({ where: {
      entityType: 'chat_room', entityId: id, actorUserId: actor.id, action,
    } }), count);
  };

  await t.test('group grant is narrow, revokes in the old session; direct deny/default and idempotency', async () => {
    const body = { title: `${marker}-created`, participantUserIds: [peer.id] };
    await denied('/rooms/group', 'POST', body);
    await withRule('chat.room.group', 'allow', undefined, async () => {
      const created = await success<ChatRoomResponseDto>('/rooms/group', 'POST', body, 201);
      assert.equal(created.roomType, 'group');
      assert.equal(created.capabilities.canManage, true);
      const members = await prisma.chatRoomParticipant.findMany({ where: { chatRoomId: created.id } });
      assert.deepEqual(new Set(members.map((row) => row.userId)), new Set([actor.id, peer.id]));
      assert.equal(members.find((row) => row.userId === actor.id)!.roleInRoom, 'admin');
      await audit(created.id, 'chat.room.group.created');
      assert.equal((await roomDto(a.id)).capabilities.canManage, false, 'Creation grants do not administer unrelated rooms');
      await withRule('chat.room.group', 'deny', undefined, () => denied('/rooms/group', 'POST', body));
      await withRule('chat.access', 'deny', undefined, () => denied('/rooms/group', 'POST', body));
    });
    await denied('/rooms/group', 'POST', body);
    const directBody = { targetUserId: extra.id };
    await withRule('chat.room.direct', 'deny', undefined, () => denied('/rooms/direct', 'POST', directBody));
    const direct = await success<ChatRoomResponseDto>('/rooms/direct', 'POST', directBody, 201);
    assert.equal(direct.roomType, 'direct');
    await audit(direct.id, 'chat.room.direct.created');
    const before = await snapshot();
    assert.equal((await success<ChatRoomResponseDto>('/rooms/direct', 'POST', directBody, 201)).id, direct.id);
    const normalizeReopen = (state: Awaited<ReturnType<typeof snapshot>>) => ({
      ...state, participants: state.participants.map((row) => ({ ...row, updatedAt: null })),
    });
    // Reopen upserts current participants, touching updatedAt only; it must not
    // reset joinedAt, role, read state, membership identity or create audit.
    assert.deepEqual(normalizeReopen(await snapshot()), normalizeReopen(before));
    await withRule('chat.access', 'deny', undefined, () => denied('/rooms/direct', 'POST', directBody));
  });

  await t.test('read leaf and parent denies suppress selected-room bodies and previews, not B; default restores', async () => {
    assert.equal((await roomDto(a.id)).lastMessagePreview, `${marker}-preview-A`);
    assert.ok((await roomDto(a.id)).unreadCount > 0);
    for (const action of ['chat.messages.read', 'chat.read', 'chat.access']) {
      await withRule(action, 'allow', [a.id], async () => {
        await withRule(action, 'deny', [a.id], async () => {
          for (const path of [`/rooms/${a.id}/messages`, `/rooms/${a.id}/participants`, `/messages/${own[0].id}`]) await denied(path);
          assert.ok((await success<ChatMessageResponseDto[]>(`/rooms/${b.id}/messages`)).some((row) => row.id === own[1].id));
          const before = await snapshot();
          const list = await success<ChatRoomResponseDto[]>('/rooms');
          const selected = list.find((row) => row.id === a.id);
          if (action === 'chat.messages.read') {
            assert.ok(selected);
            assert.equal(selected.lastMessagePreview, null);
            assert.equal(selected.unreadCount, 0);
          } else assert.equal(selected, undefined);
          assert.ok(list.some((row) => row.id === b.id));
          assert.equal(JSON.stringify(list).includes(hiddenMessage.text!), false);
          assert.deepEqual(await snapshot(), before);
        });
      });
      assert.equal((await success<ChatMessageResponseDto>(`/messages/${own[0].id}`)).id, own[0].id);
    }
  });

  await t.test('selected rename/member grants are independent, audited, denyable and revoked without role leakage', async () => {
    await denied(`/rooms/${a.id}`, 'PATCH', { title: `${marker}-renamed` });
    await denied(`/rooms/${a.id}/participants`, 'POST', { userIds: [extra.id] });
    await withRule('chat.room.manage_members', 'allow', [a.id], async () => {
      assert.equal((await roomDto(a.id)).capabilities.canManageMembers, true);
      assert.equal((await roomDto(a.id)).capabilities.canManage, false);
      assert.equal((await roomDto(b.id)).capabilities.canManageMembers, false);
      await denied(`/rooms/${b.id}/participants`, 'POST', { userIds: [extra.id] });
      await denied(`/rooms/${a.id}`, 'PATCH', { title: 'No admin leakage' });
      for (const gate of ['chat.room.manage_members', 'chat.access']) await withRule(gate, 'deny', [a.id], () => denied(`/rooms/${a.id}/participants`, 'POST', { userIds: [extra.id] }));
      await success(`/rooms/${a.id}/participants`, 'POST', { userIds: [extra.id, founder.id] }, 201);
      await audit(a.id, 'chat.room.participants_added');
      const before = await snapshot();
      await success(`/rooms/${a.id}/participants`, 'POST', { userIds: [extra.id, founder.id] }, 201);
      assert.deepEqual(await snapshot(), before, 'Adding active members must not reset history/admin roles');
      await success(`/rooms/${a.id}/participants/${extra.id}`, 'DELETE');
      await audit(a.id, 'chat.room.participant_removed');
      const removed = await prisma.chatRoomParticipant.findUniqueOrThrow({ where: { chatRoomId_userId: { chatRoomId: a.id, userId: extra.id } } });
      assert.ok(removed.leftAt);
      assert.equal((await prisma.chatRoomParticipant.findUniqueOrThrow({ where: { chatRoomId_userId: { chatRoomId: a.id, userId: founder.id } } })).roleInRoom, 'admin');
    });
    assert.equal((await roomDto(a.id)).capabilities.canManageMembers, false);
    await denied(`/rooms/${a.id}/participants`, 'POST', { userIds: [extra.id] });
    await withRule('chat.room.update', 'allow', [a.id], async () => {
      assert.equal((await roomDto(a.id)).capabilities.canManage, true);
      assert.equal((await roomDto(b.id)).capabilities.canManage, false);
      await denied(`/rooms/${b.id}`, 'PATCH', { title: 'Denied control rename' });
      for (const gate of ['chat.room.update', 'chat.access']) await withRule(gate, 'deny', [a.id], () => denied(`/rooms/${a.id}`, 'PATCH', { title: 'Denied rename' }));
      await success(`/rooms/${a.id}`, 'PATCH', { title: `${marker}-renamed` });
      assert.equal((await prisma.chatRoom.findUniqueOrThrow({ where: { id: a.id } })).title, `${marker}-renamed`);
      await audit(a.id, 'chat.room.renamed');
    });
    await denied(`/rooms/${a.id}`, 'PATCH', { title: 'Revoked rename' });
  });

  await t.test('message create/edit/delete honor A denies, B control, authorship and edit history', async () => {
    const sent = await success<ChatMessageResponseDto>(`/rooms/${a.id}/messages`, 'POST', { text: `${marker}-sent` }, 201);
    const saved = await prisma.chatMessage.findUniqueOrThrow({ where: { id: sent.id } });
    assert.equal(saved.authorUserId, actor.id);
    assert.equal(saved.chatRoomId, a.id);
    assert.equal(saved.text, `${marker}-sent`);
    for (const leaf of ['chat.messages.create', 'chat.messages.edit', 'chat.messages.delete']) {
      await withRule(leaf, 'allow', [a.id], async () => {
        await withRule(leaf, 'deny', [a.id], async () => {
          const dto = await success<ChatMessageResponseDto>(`/messages/${own[0].id}`);
          const control = await success<ChatMessageResponseDto>(`/messages/${own[1].id}`);
          if (leaf.endsWith('create')) {
            assert.equal((await roomDto(a.id)).capabilities.canWrite, false);
            assert.equal((await roomDto(b.id)).capabilities.canWrite, true);
            await denied(`/rooms/${a.id}/messages`, 'POST', { text: 'Denied send' });
            await success(`/rooms/${b.id}/messages`, 'POST', { text: `${marker}-control` }, 201);
          } else if (leaf.endsWith('edit')) {
            assert.equal(dto.capabilities.canEdit, false);
            assert.equal(control.capabilities.canEdit, true);
            await denied(`/messages/${own[0].id}`, 'PATCH', { text: 'Denied edit' });
            await success(`/messages/${own[1].id}`, 'PATCH', { text: `${marker}-control-edit` });
          } else {
            assert.equal(dto.capabilities.canDelete, false);
            assert.equal(control.capabilities.canDelete, true);
            await denied(`/messages/${own[0].id}/delete`, 'POST');
          }
        });
        for (const gate of ['chat.read', 'chat.access']) await withRule(gate, 'deny', [a.id], async () => {
          if (leaf.endsWith('create')) await denied(`/rooms/${a.id}/messages`, 'POST', { text: 'Parent-denied send' });
          else if (leaf.endsWith('edit')) await denied(`/messages/${own[0].id}`, 'PATCH', { text: 'Parent-denied edit' });
          else await denied(`/messages/${own[0].id}/delete`, 'POST');
        });
      });
    }
    assert.equal((await roomDto(a.id)).capabilities.canWrite, true);
    const defaultOwn = await success<ChatMessageResponseDto>(`/messages/${own[0].id}`);
    assert.equal(defaultOwn.capabilities.canEdit, true);
    assert.equal(defaultOwn.capabilities.canDelete, true);
    await withRule('chat.messages.edit', 'allow', [a.id], async () => {
      await denied(`/messages/${foreign.id}`, 'PATCH', { text: 'Not my message' });
      const expired = await prisma.chatMessage.create({ data: {
        chatRoomId: a.id, authorUserId: actor.id, messageType: 'user', text: `${marker}-expired`,
        createdAt: new Date(Date.now() - 31 * 60 * 1000),
      } });
      await denied(`/messages/${expired.id}`, 'PATCH', { text: 'Grant cannot extend edit window' });
      const edited = await success<ChatMessageResponseDto>(`/messages/${own[0].id}`, 'PATCH', { text: `${marker}-edited` });
      assert.ok(edited.editedAt);
      const history = await prisma.chatMessageEditHistory.findMany({ where: { chatMessageId: own[0].id } });
      assert.equal(history.length, 1);
      assert.equal(history[0].editedByUserId, actor.id);
      assert.equal(history[0].oldText, own[0].text);
      assert.equal(history[0].newText, `${marker}-edited`);
    });
    await withRule('chat.messages.delete', 'allow', [a.id], () => denied(`/messages/${foreign.id}/delete`, 'POST'));
    const deleted = await success<ChatMessageResponseDto>(`/messages/${own[0].id}/delete`, 'POST', undefined, 201);
    assert.equal(deleted.isDeleted, true);
    assert.equal(deleted.text, 'Сообщение удалено автором');
    assert.equal(deleted.attachments.length, 0);
    assert.equal(deleted.capabilities.canEdit, false);
    assert.equal(deleted.capabilities.canDelete, false);
    const tombstone = await prisma.chatMessage.findUniqueOrThrow({ where: { id: own[0].id } });
    assert.equal(tombstone.deletedByUserId, actor.id);
    assert.equal(tombstone.deletedByKind, 'author');
    assert.ok(tombstone.deletedAt);
    await denied(`/messages/${own[0].id}`, 'PATCH', { text: 'Cannot revive tombstone' });
  });

  await t.test('hide/unhide/leave remain personal and audited; leaving revokes the current cookie', async () => {
    for (const [leaf, route] of [['chat.room.hide', 'hide'], ['chat.room.unhide', 'unhide'], ['chat.room.leave', 'leave']] as const) {
      await withRule(leaf, 'deny', [a.id], () => denied(`/rooms/${a.id}/${route}`, 'POST'));
    }
    const peerBefore = await prisma.chatRoomParticipant.findUniqueOrThrow({ where: { chatRoomId_userId: { chatRoomId: a.id, userId: peer.id } } });
    await success(`/rooms/${a.id}/hide`, 'POST', undefined, 201);
    await audit(a.id, 'chat.room.hidden');
    assert.ok((await prisma.chatRoomParticipant.findUniqueOrThrow({ where: { chatRoomId_userId: { chatRoomId: a.id, userId: actor.id } } })).hiddenAt);
    assert.equal((await success<ChatRoomResponseDto[]>('/rooms')).some((room) => room.id === a.id), false);
    assert.ok((await success<ChatRoomResponseDto[]>('/rooms?view=archived')).some((room) => room.id === a.id));
    await success(`/rooms/${a.id}/unhide`, 'POST', undefined, 201);
    await audit(a.id, 'chat.room.unhidden');
    assert.equal((await prisma.chatRoomParticipant.findUniqueOrThrow({ where: { chatRoomId_userId: { chatRoomId: a.id, userId: actor.id } } })).hiddenAt, null);
    await success(`/rooms/${a.id}/leave`, 'POST', undefined, 201);
    await audit(a.id, 'chat.room.left');
    assert.deepEqual(await prisma.chatRoomParticipant.findUniqueOrThrow({ where: { id: peerBefore.id } }), peerBefore);
    await withRule('chat.read', 'allow', [a.id], async () => {
      await denied(`/rooms/${a.id}/messages`);
      await denied(`/rooms/${a.id}/messages`, 'POST', { text: 'Cannot rejoin through grant' });
      await denied(`/rooms/${a.id}/unhide`, 'POST');
    });
    assert.equal((await success<ChatMessageResponseDto>(`/messages/${own[1].id}`)).id, own[1].id);
    assert.ok((await success<ChatRoomResponseDto[]>('/rooms', 'GET', undefined, 200, peerCookie)).some((room) => room.id === a.id));
  });

  await t.test('explicit read/write/member grants never admit a nonmember or expose hidden history', async () => {
    const before = await snapshot();
    const rules: Array<{ id: string }> = [];
    try {
      for (const actionCode of ['chat.access', 'chat.read', 'chat.messages.read', 'chat.messages.create', 'chat.room.manage_members']) rules.push(await prisma.userAccessRule.create({ data: {
        userId: actor.id, actionCode, effect: 'allow', scope: 'selected', selectedIds: [hidden.id],
      } }));
      for (const path of [`/rooms/${hidden.id}/messages`, `/rooms/${hidden.id}/participants`, `/messages/${hiddenMessage.id}`]) await denied(path);
      await denied(`/rooms/${hidden.id}/messages`, 'POST', { text: 'No membership' });
      await denied(`/rooms/${hidden.id}/participants`, 'POST', { userIds: [actor.id] });
      const list = await success<ChatRoomResponseDto[]>('/rooms');
      assert.equal(list.some((room) => room.id === hidden.id), false);
      assert.equal(await prisma.chatRoomParticipant.count({ where: { chatRoomId: hidden.id, userId: actor.id } }), 0);
      assert.deepEqual(await snapshot(), before);
    } finally {
      await prisma.userAccessRule.deleteMany({ where: { id: { in: rules.map((rule) => rule.id) } } });
    }
  });

  await t.test('selected room-update grant must not mutate an unrelated nonmember room before returning forbidden', async () => {
    // Regression target: checking membership only while mapping the response is
    // too late. A 403 after title/audit writes is still an unauthorized effect.
    await withRule('chat.room.update', 'allow', [hidden.id], () => denied(`/rooms/${hidden.id}`, 'PATCH', { title: 'Nonmember must not rename' }));
  });
});
