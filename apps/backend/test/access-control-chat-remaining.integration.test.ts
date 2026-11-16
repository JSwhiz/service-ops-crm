import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PrismaClient } from '@prisma/client';

import { ChatRealtimeService, type ChatRealtimeEvent } from '../src/modules/chats/chat-realtime.service';
import { ChatsService } from '../src/modules/chats/chats.service';
import type { ChatMessageResponseDto, ChatRoomResponseDto } from '../src/modules/chats/dto/chat-response.dto';
import type { ChatSearchResponseDto } from '../src/modules/chats/dto/chat-search-response.dto';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { loginAndGetCookieHeader } from './helpers/auth';
import { createTestApp } from './helpers/create-test-app';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';

test('remaining chat leaves preserve source/target membership, history boundaries and current-session revocation', async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.match(url.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  const prisma = new PrismaClient();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  t.after(async () => { try { await closeApp?.(); } finally { await prisma.$disconnect(); } });
  const { app, baseUrl } = await createTestApp();
  closeApp = () => app.close();
  const [actor, peer, founder] = await Promise.all(['manager1', 'manager2', 'founder'].map((login) =>
    prisma.user.findUniqueOrThrow({ where: { login }, include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      permissions: { include: { permission: true } },
    } })));
  assert.deepEqual(actor.roles.map(({ role }) => role.code), ['manager']);
  assert.equal([...actor.permissions.map(({ permission }) => permission.code),
    ...actor.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code))].includes('chat.room.close_global'), false);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id } }), 0);
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const founderCookie = await loginAndGetCookieHeader({ baseUrl, login: founder.login, password: 'founder123' });
  const request = (path: string, method = 'GET', body?: unknown, auth = cookie): Promise<Response> => fetch(`${baseUrl}/api/v1/chats${path}`, {
    method, headers: { Cookie: auth, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const ok = async <T>(path: string, method = 'GET', body?: unknown, expected = 200, auth = cookie): Promise<T> => {
    const response = await request(path, method, body, auth);
    assert.equal(response.status, expected, `${method} ${path}: ${await response.clone().text()}`);
    return response.json() as Promise<T>;
  };
  await ok('/rooms'); // Warm system-room memberships before no-effects checks.
  const marker = `acl-chat-remaining-${randomUUID()}`;
  const joinedAt = new Date(Date.now() - 60_000);
  const fixture = (label: string, member = true) => prisma.chatRoom.create({ data: {
    title: `${marker}-${label}`, roomType: 'group', visibilityType: 'explicit_members', createdByUserId: founder.id,
    participants: { create: [
      { userId: founder.id, roleInRoom: 'admin', joinedAt }, { userId: peer.id, roleInRoom: 'member', joinedAt },
      ...(member ? [{ userId: actor.id, roleInRoom: 'member', joinedAt }] : []),
    ] },
  } });
  const a = await fixture('A'), b = await fixture('B'), late = await fixture('late'), hidden = await fixture('hidden', false);
  const messages = await Promise.all([a, b, late, hidden].map((room) => prisma.chatMessage.create({ data: {
    chatRoomId: room.id, authorUserId: peer.id, messageType: 'user', text: `${marker}-message-${room.id}`,
  } })));
  const [ma, mb, ml, mh] = messages;
  const old = await prisma.chatMessage.create({ data: {
    chatRoomId: late.id, authorUserId: peer.id, messageType: 'user', text: `${marker}-before-membership`, createdAt: new Date(joinedAt.getTime() - 1),
  } });
  const system = await prisma.chatMessage.create({ data: {
    chatRoomId: a.id, authorUserId: founder.id, messageType: 'system', text: `${marker}-system`,
  } });
  const deleted = await prisma.chatMessage.create({ data: {
    chatRoomId: a.id, authorUserId: peer.id, messageType: 'user', text: `${marker}-deleted`, deletedAt: new Date(), deletedByUserId: peer.id, deletedByKind: 'author',
  } });
  const capture = async () => ({
    rooms: await prisma.chatRoom.findMany({ orderBy: { id: 'asc' } }),
    members: await prisma.chatRoomParticipant.findMany({ orderBy: { id: 'asc' } }),
    messages: await prisma.chatMessage.findMany({ orderBy: { id: 'asc' } }),
    edits: await prisma.chatMessageEditHistory.findMany({ orderBy: { id: 'asc' } }),
    reactions: await prisma.chatMessageReaction.findMany({ orderBy: { id: 'asc' } }),
    attachments: await prisma.fileAttachment.findMany({ orderBy: { id: 'asc' } }),
    notifications: await prisma.notification.findMany({ orderBy: { id: 'asc' } }),
    audit: await prisma.auditEvent.findMany({ orderBy: { id: 'asc' } }),
  });
  const denied = async (path: string, method = 'GET', body?: unknown, expected = 403, auth = cookie) => {
    const before = await capture();
    const response = await request(path, method, body, auth);
    assert.equal(response.status, expected, `${method} ${path}: ${await response.clone().text()}`);
    assert.deepEqual(await capture(), before, 'Denied request changes no room/member/message/history/reaction/attachment/notification/audit');
  };
  const rule = async (actionCode: string, effect: 'allow' | 'deny', selectedIds: string[] | undefined, run: () => Promise<void>) => {
    const previous = await prisma.userAccessRule.findUnique({ where: { userId_actionCode: { userId: actor.id, actionCode } } });
    const data = { effect, scope: selectedIds ? 'selected' : 'all', selectedIds: selectedIds ?? [] };
    const saved = previous ? await prisma.userAccessRule.update({ where: { id: previous.id }, data })
      : await prisma.userAccessRule.create({ data: { userId: actor.id, actionCode, ...data } });
    try { await run(); } finally {
      if (previous) await prisma.userAccessRule.update({ where: { id: saved.id }, data: { effect: previous.effect, scope: previous.scope, selectedIds: previous.selectedIds } });
      else await prisma.userAccessRule.delete({ where: { id: saved.id } });
    }
  };
  const searchPath = (roomId?: string, before?: string) => `/search?${new URLSearchParams({ q: marker, ...(roomId ? { roomId } : {}), ...(before ? { before } : {}) })}`;
  const search = async (roomId?: string) => {
    const before = await capture();
    const result = await ok<ChatSearchResponseDto>(searchPath(roomId));
    assert.equal(JSON.stringify(result).includes(mh.text!), false);
    assert.equal(JSON.stringify(result).includes(old.text!), false);
    assert.equal(JSON.stringify(result).includes(deleted.text!), false);
    assert.deepEqual(await capture(), before, 'Search is read-only');
    return result;
  };
  const eligibility = app.get(ChatRealtimeService) as unknown as {
    canDeliver(userId: string, event: ChatRealtimeEvent): Promise<boolean>;
  };
  const eligible = (roomId: string, messageId: string) => eligibility.canDeliver(actor.id, {
    type: 'chat.message_created', roomId, recipientUserIds: [actor.id], payload: { id: messageId },
  });

  await t.test('room child capabilities match independent scoped API gates, default/revoke and active membership', async () => {
    const flags = (room: ChatRoomResponseDto) => ({
      canWrite: room.capabilities.canWrite, canSearch: room.capabilities.canSearch,
      canReadReceipts: room.capabilities.canReadReceipts, canForwardToRoom: room.capabilities.canForwardToRoom,
    });
    const baseline = { canWrite: true, canSearch: true, canReadReceipts: true, canForwardToRoom: true };
    const list = async (view = 'active') => {
      const before = await capture();
      const result = await ok<ChatRoomResponseDto[]>(`/rooms?view=${view}`);
      assert.deepEqual(await capture(), before, 'Capability reads cannot change room/member/message/audit state');
      return result;
    };
    const assertPair = async (expected: typeof baseline) => {
      const rooms = await list();
      assert.deepEqual(flags(rooms.find(({ id }) => id === a.id)!), expected);
      assert.deepEqual(flags(rooms.find(({ id }) => id === b.id)!), baseline, 'Control B retains its own exact child flags');
      assert.equal(rooms.some(({ id }) => id === hidden.id), false, 'Flags do not manufacture membership');
    };
    await assertPair(baseline);
    for (const [gate, changes] of [
      ['chat.search', { canSearch: false }],
      ['chat.read_receipts', { canReadReceipts: false }],
      ['chat.messages.forward', { canForwardToRoom: false }],
      ['chat.messages.create', { canWrite: false, canForwardToRoom: false }],
      ['chat.messages.read', { canSearch: false, canReadReceipts: false }],
    ] as const) {
      await rule(gate, 'deny', [a.id], () => assertPair({ ...baseline, ...changes }));
      await assertPair(baseline); // Same pre-existing cookie after revoke.
    }
    for (const gate of ['chat.read', 'chat.access']) await rule(gate, 'deny', [a.id], async () => {
      const rooms = await list();
      assert.equal(rooms.some(({ id }) => id === a.id), false);
      assert.deepEqual(flags(rooms.find(({ id }) => id === b.id)!), baseline);
    });
    for (const gate of ['chat.search', 'chat.read_receipts', 'chat.messages.forward']) {
      await rule(gate, 'allow', [hidden.id], async () => {
        assert.equal((await list()).some(({ id }) => id === hidden.id), false);
      });
      await rule(gate, 'allow', [a.id], () => rule('chat.access', 'deny', [a.id], async () => {
        assert.equal((await list()).some(({ id }) => id === a.id), false, 'Child allow cannot override parent deny');
      }));
    }
    await rule('chat.search', 'deny', undefined, async () => {
      for (const room of await list()) assert.equal(room.capabilities.canSearch, false);
    });
    const archived = await fixture('child-flags-archived');
    await ok(`/rooms/${archived.id}/hide`, 'POST', undefined, 201);
    assert.equal((await list()).some(({ id }) => id === archived.id), false);
    assert.deepEqual(flags((await list('archived')).find(({ id }) => id === archived.id)!), {
      ...baseline, canSearch: false,
    }, 'Hidden rooms are excluded from search, not from the independent target/read-receipt APIs');
    await ok(`/rooms/${archived.id}/unhide`, 'POST', undefined, 201);
    assert.deepEqual(flags((await list()).find(({ id }) => id === archived.id)!), baseline);
  });

  await t.test('search filters selected leaf/read/parent denies before results and cursor resolution', async () => {
    const baseline = await search();
    assert.ok(baseline.messages.some(({ id }) => id === ma.id));
    assert.ok(baseline.messages.some(({ id }) => id === mb.id));
    for (const gate of ['chat.search', 'chat.messages.read', 'chat.read', 'chat.access']) {
      await rule(gate, 'deny', [a.id], async () => {
        const result = await search();
        assert.equal(result.rooms.some(({ id }) => id === a.id), false);
        assert.equal(result.messages.some(({ roomId }) => roomId === a.id), false);
        assert.ok(result.messages.some(({ id }) => id === mb.id));
        assert.deepEqual((await search(a.id)).messages, []);
        await denied(searchPath(a.id, ma.id), 'GET', undefined, 400);
      });
      assert.ok((await search(a.id)).messages.some(({ id }) => id === ma.id));
    }
    await rule('chat.search', 'allow', [hidden.id], async () => {
      assert.deepEqual((await search(hidden.id)).messages, []);
      await denied(`/messages/${mh.id}`);
    });
    await rule('chat.search', 'deny', undefined, () => denied(searchPath()));
    assert.ok((await search()).messages.some(({ id }) => id === ma.id));
  });

  await t.test('forward checks both room scopes and cannot grant membership or cross the joined/deleted/system boundaries', async () => {
    const forward = (id: string, targetRoomId: string) => ok<ChatMessageResponseDto>(`/messages/${id}/forward`, 'POST', { targetRoomId }, 201);
    for (const gate of ['chat.messages.forward', 'chat.read', 'chat.access']) {
      for (const roomId of [a.id, b.id]) await rule(gate, 'deny', [roomId], () => denied(`/messages/${ma.id}/forward`, 'POST', { targetRoomId: b.id }));
    }
    await rule('chat.messages.create', 'deny', [b.id], () => denied(`/messages/${ma.id}/forward`, 'POST', { targetRoomId: b.id }));
    await rule('chat.messages.forward', 'allow', undefined, async () => {
      for (const id of [mh.id, old.id, system.id, deleted.id]) await denied(`/messages/${id}/forward`, 'POST', { targetRoomId: b.id });
      await denied(`/messages/${ma.id}/forward`, 'POST', { targetRoomId: hidden.id });
      const before = await capture();
      const result = await forward(ma.id, b.id);
      assert.equal(result.chatRoomId, b.id);
      assert.equal(result.text, ma.text);
      const after = await capture();
      const added = after.messages.filter((row) => !before.messages.some(({ id }) => id === row.id));
      assert.equal(added.length, 1);
      assert.equal(added[0].id, result.id);
      assert.equal(added[0].authorUserId, actor.id);
      assert.equal(added[0].forwardedFromMessageId, ma.id);
      assert.deepEqual({ ...after, rooms: after.rooms.filter(({ id }) => id !== b.id), messages: after.messages.filter(({ id }) => id !== result.id),
        members: after.members.map((row) => row.chatRoomId === b.id ? { ...row, updatedAt: null } : row),
      }, { ...before, rooms: before.rooms.filter(({ id }) => id !== b.id), members: before.members.map((row) => row.chatRoomId === b.id ? { ...row, updatedAt: null } : row) });
      const target = after.rooms.find(({ id }) => id === b.id)!;
      const originalTarget = before.rooms.find(({ id }) => id === b.id)!;
      assert.equal(target.lastMessagePreview, ma.text);
      assert.ok(target.lastMessageAt);
      assert.deepEqual({ ...target, lastMessageAt: originalTarget.lastMessageAt,
        lastMessagePreview: originalTarget.lastMessagePreview, updatedAt: originalTarget.updatedAt }, originalTarget);
    });
    assert.equal((await forward(mb.id, late.id)).chatRoomId, late.id, 'Default retains membership-based authority after allow removal');
  });

  await t.test('reaction selected denies leave B usable and toggling changes only the actor heart row', async () => {
    for (const gate of ['chat.messages.react', 'chat.messages.read', 'chat.access']) await rule(gate, 'deny', [a.id], async () => {
      await denied(`/messages/${ma.id}/reactions/heart`, 'POST');
      if (gate === 'chat.messages.react') assert.equal((await ok<ChatMessageResponseDto>(`/messages/${ma.id}`)).capabilities.canReact, false);
      const beforeControl = await capture();
      assert.equal((await ok<ChatMessageResponseDto>(`/messages/${mb.id}`)).capabilities.canReact, true);
      const control = await ok<ChatMessageResponseDto>(`/messages/${mb.id}/reactions/heart`, 'POST', undefined, 201);
      assert.ok(control.myReactions.includes('heart'));
      await ok(`/messages/${mb.id}/reactions/heart`, 'POST', undefined, 201);
      assert.deepEqual(await capture(), beforeControl, 'B remains actionable under an A-only deny');
    });
    const before = await capture();
    const reacted = await ok<ChatMessageResponseDto>(`/messages/${mb.id}/reactions/heart`, 'POST', undefined, 201);
    assert.ok(reacted.myReactions.includes('heart'));
    const after = await capture();
    const added = after.reactions.filter((row) => !before.reactions.some(({ id }) => id === row.id));
    assert.equal(added.length, 1);
    assert.equal(added[0].chatMessageId, mb.id);
    assert.equal(added[0].userId, actor.id);
    assert.equal(added[0].reactionType, 'heart');
    assert.deepEqual({ ...after, reactions: before.reactions }, before);
    await ok(`/messages/${mb.id}/reactions/heart`, 'POST', undefined, 201);
    assert.deepEqual(await capture(), before);
    await rule('chat.messages.react', 'allow', undefined, async () => {
      for (const id of [mh.id, old.id, system.id, deleted.id]) await denied(`/messages/${id}/reactions/heart`, 'POST');
    });
  });

  await t.test('read receipts change only self read state, are monotonic and cannot use another room or pre-join message', async () => {
    for (const gate of ['chat.read_receipts', 'chat.messages.read', 'chat.access']) await rule(gate, 'deny', [a.id], () => denied(`/rooms/${a.id}/read`, 'POST', { lastReadMessageId: ma.id }));
    await rule('chat.read_receipts', 'allow', undefined, async () => {
      await denied(`/rooms/${hidden.id}/read`, 'POST', { lastReadMessageId: mh.id });
      await denied(`/rooms/${a.id}/read`, 'POST', { lastReadMessageId: mb.id }, 404);
      await denied(`/rooms/${late.id}/read`, 'POST', { lastReadMessageId: old.id }, 404);
    });
    const before = await capture();
    await ok(`/rooms/${a.id}/read`, 'POST', { lastReadMessageId: system.id }, 201);
    const after = await capture();
    const membership = after.members.find((row) => row.chatRoomId === a.id && row.userId === actor.id)!;
    assert.equal(membership.lastReadAt!.toISOString(), system.createdAt.toISOString());
    const original = before.members.find(({ id }) => id === membership.id)!;
    assert.deepEqual({ ...membership, lastReadAt: original.lastReadAt, updatedAt: original.updatedAt }, original);
    assert.deepEqual({ ...after, members: after.members.map((row) => row.id === membership.id ? original : row) }, before);
    await ok(`/rooms/${a.id}/read`, 'POST', { lastReadMessageId: ma.id }, 201);
    assert.equal((await prisma.chatRoomParticipant.findUniqueOrThrow({ where: { id: membership.id } })).lastReadAt!.toISOString(), system.createdAt.toISOString());
  });

  await t.test('realtime uses fresh actual DB eligibility, not stale recipients; this is NOT socket/publication evidence', async () => {
    const before = await capture();
    assert.equal(await eligible(a.id, ma.id), true);
    for (const gate of ['chat.realtime', 'chat.messages.read', 'chat.read', 'chat.access']) {
      await rule(gate, 'deny', [a.id], async () => {
        assert.equal(await eligible(a.id, ma.id), false);
        assert.equal(await eligible(b.id, mb.id), true);
      });
      assert.equal(await eligible(a.id, ma.id), true);
    }
    await rule('chat.realtime', 'allow', [hidden.id], async () => { assert.equal(await eligible(hidden.id, mh.id), false); });
    assert.deepEqual(await capture(), before, 'Eligibility evaluation must be read-only');
    await ok(`/rooms/${late.id}/leave`, 'POST', undefined, 201);
    assert.equal((await ok<ChatRoomResponseDto[]>('/rooms')).some(({ id }) => id === late.id), false, 'Left room exposes no child capability');
    await rule('chat.realtime', 'allow', [late.id], async () => { assert.equal(await eligible(late.id, ml.id), false); });
    await denied(`/rooms/${late.id}/messages`);
  });

  await t.test('selected global-close authority is distinct from membership/admin, denyable and revoked with the same cookie', async () => {
    await denied(`/rooms/${a.id}/close`, 'POST', { reason: marker });
    await rule('chat.room.close_global', 'allow', [a.id], async () => {
      await denied(`/rooms/${b.id}/close`, 'POST', { reason: marker });
      const list = await ok<ChatRoomResponseDto[]>('/rooms');
      assert.equal(list.find(({ id }) => id === a.id)!.capabilities.canCloseGlobally, true);
      assert.equal(list.find(({ id }) => id === a.id)!.capabilities.canManage, false);
      assert.equal(list.find(({ id }) => id === b.id)!.capabilities.canCloseGlobally, false);
      for (const gate of ['chat.room.close_global', 'chat.access']) await rule(gate, 'deny', [a.id], () => denied(`/rooms/${a.id}/close`, 'POST', { reason: marker }));
    });
    await denied(`/rooms/${a.id}/close`, 'POST', { reason: marker });
    await rule('chat.room.close_global', 'allow', [a.id], async () => {
      const before = await capture();
      await ok(`/rooms/${a.id}/close`, 'POST', { reason: marker }, 201);
      const after = await capture();
      const changed = after.rooms.find(({ id }) => id === a.id)!;
      assert.ok(changed.deletedAt);
      assert.equal(changed.deletedByUserId, actor.id);
      assert.equal(changed.deleteReason, marker);
      const audits = after.audit.filter((row) => !before.audit.some(({ id }) => id === row.id));
      assert.equal(audits.length, 1);
      assert.equal(audits[0].entityType, 'chat_room');
      assert.equal(audits[0].entityId, a.id);
      assert.equal(audits[0].actorUserId, actor.id);
      assert.equal(audits[0].action, 'chat.room.closed_globally');
      assert.deepEqual(audits[0].newValues, { reason: marker });
      assert.deepEqual({ ...after, rooms: before.rooms, audit: before.audit }, before);
      const original = before.rooms.find(({ id }) => id === a.id)!;
      assert.deepEqual({ ...changed, deletedAt: original.deletedAt, deletedByUserId: original.deletedByUserId,
        deleteReason: original.deleteReason, updatedAt: original.updatedAt }, original);
      assert.deepEqual(after.rooms.filter(({ id }) => id !== a.id), before.rooms.filter(({ id }) => id !== a.id));
    });
    await rule('chat.realtime', 'allow', [a.id], async () => { assert.equal(await eligible(a.id, ma.id), false); });
    await denied(`/rooms/${a.id}/messages`);
    assert.equal((await ok<ChatRoomResponseDto[]>('/rooms')).some(({ id }) => id === a.id), false, 'Closed room exposes no child capability');
    assert.equal((await ok<ChatMessageResponseDto>(`/messages/${mb.id}`)).id, mb.id);
  });

  await t.test('controlled stale-preflight rename versus committed leave/removal, and fresh-title audit', async () => {
    type RenameBoundary = { renameRoom: (user: { id: string }, roomId: string, body: { title: string }) => Promise<unknown> };
    type TransactionBoundary = { $transaction: (...args: unknown[]) => Promise<unknown> };
    const service = app.get(ChatsService) as unknown as RenameBoundary;
    const database = app.get(PrismaService) as unknown as TransactionBoundary;
    const originalRename = service.renameRoom, originalTransaction = database.$transaction;
    const context = new AsyncLocalStorage<boolean>();
    for (const mode of ['leave', 'remove', 'title'] as const) {
      const room = await fixture(`race-${mode}`);
      await rule('chat.room.update', 'allow', [room.id], async () => {
        let release!: () => void, entered!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const reached = new Promise<void>((resolve) => { entered = resolve; });
        const staleTitle = `${marker}-${mode}-stale`, winnerTitle = `${marker}-committed-title`;
        let claimed = false;
        service.renameRoom = (user, id, body) => context.run(user.id === actor.id && id === room.id && body.title === staleTitle,
          () => originalRename.call(service, user, id, body));
        database.$transaction = async (...args) => {
          // Pause only this HTTP rename after its real preflight, immediately
          // before opening its genuine transaction. No fake DB results/locks.
          if (!claimed && context.getStore() && typeof args[0] === 'function') {
            claimed = true; entered(); await gate;
          }
          return originalTransaction.apply(database, args);
        };
        const stale = request(`/rooms/${room.id}`, 'PATCH', { title: staleTitle });
        void stale.catch(() => undefined);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([reached, new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error(`Rename ${mode} did not reach transaction boundary`)), 5_000);
          })]);
          if (timer) { clearTimeout(timer); timer = undefined; }
          const beforeWinner = await capture();
          if (mode === 'leave') await ok(`/rooms/${room.id}/leave`, 'POST', undefined, 201);
          else if (mode === 'remove') await ok(`/rooms/${room.id}/participants/${actor.id}`, 'DELETE', undefined, 200, founderCookie);
          else await ok(`/rooms/${room.id}`, 'PATCH', { title: winnerTitle }, 200, founderCookie);
          const committed = await capture();
          release();
          const response = await stale;
          assert.equal(response.status, mode === 'title' ? 200 : 403, await response.clone().text());
          const after = await capture();
          if (mode !== 'title') assert.deepEqual(after, committed, 'Stale rename must preserve the winner without title or audit effects');
          else {
            const added = after.audit.filter((row) => !beforeWinner.audit.some(({ id }) => id === row.id));
            assert.equal(added.length, 2);
            const winnerAudit = added.find(({ actorUserId }) => actorUserId === founder.id)!;
            const staleAudit = added.find(({ actorUserId }) => actorUserId === actor.id)!;
            for (const row of added) { assert.equal(row.action, 'chat.room.renamed'); assert.equal(row.entityId, room.id); assert.equal(row.entityType, 'chat_room'); }
            assert.deepEqual(winnerAudit.oldValues, { title: room.title });
            assert.deepEqual(winnerAudit.newValues, { title: winnerTitle });
            assert.deepEqual(staleAudit.oldValues, { title: winnerTitle });
            assert.deepEqual(staleAudit.newValues, { title: staleTitle });
            const changed = after.rooms.find(({ id }) => id === room.id)!;
            const original = committed.rooms.find(({ id }) => id === room.id)!;
            assert.equal(changed.title, staleTitle);
            assert.deepEqual({ ...changed, title: original.title, updatedAt: original.updatedAt }, original);
            assert.deepEqual({ ...after, rooms: committed.rooms, audit: committed.audit }, committed);
            assert.deepEqual(after.rooms.filter(({ id }) => id !== room.id), committed.rooms.filter(({ id }) => id !== room.id));
          }
        } finally {
          if (timer) clearTimeout(timer);
          release();
          await stale.catch(() => undefined);
          service.renameRoom = originalRename;
          database.$transaction = originalTransaction;
        }
      });
    }
  });
});
