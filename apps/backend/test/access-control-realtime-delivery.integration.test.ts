import 'reflect-metadata';

import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { createConnection } from 'node:net';
import test from 'node:test';

import { Test } from '@nestjs/testing';
import { PrismaClient, type Notification } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { ChatRealtimeService, type ChatRealtimeEvent, type NotificationRealtimeEvent, type RealtimeEvent } from '../src/modules/chats/chat-realtime.service';
import { CHAT_REDIS_CHANNEL } from '../src/modules/chats/constants/chat.constants';
import type { ChatMessageResponseDto } from '../src/modules/chats/dto/chat-response.dto';
import { FilePreviewService } from '../src/modules/files/file-preview.service';
import { RedisService } from '../src/modules/redis/redis.service';
import { StorageService } from '../src/modules/storage/storage.service';
import { ACCESS_ACTION_CATALOG } from '../src/modules/users-access/access-action-catalog';
import { loginAndGetCookieHeader } from './helpers/auth';
import { usesIsolatedIntegrationDatabase } from './helpers/isolated-database';
import { hasRealtimeEventIdentity } from './helpers/realtime-frame-match';

// Real HTTP login, Prisma, upgrade/authentication and TCP WebSocket frames.
// NOT real Redis: replace RedisService before AppModule lifecycle, so even the
// hardcoded CHAT_REDIS_CHANNEL can never reach another application. Publication
// still enters the production subscriber callback and ordered delivery queue.
// Preview conversion is disabled; the sole file is metadata in this schema,
// with no binary upload, object-store access, preview worker or external jobs.
function isolatedPublication() {
  const listeners = new Set<(message: string) => void>();
  const published: RealtimeEvent[] = [];
  return {
    published,
    provider: {
      getClient: () => ({
        duplicate: () => {
          let listener: ((message: string) => void) | undefined;
          const subscriber = {
            isOpen: false,
            connect: async () => { subscriber.isOpen = true; },
            subscribe: async (channel: string, callback: (message: string) => void) => {
              assert.equal(channel, CHAT_REDIS_CHANNEL);
              listener = callback;
              listeners.add(callback);
            },
            quit: async () => {
              if (listener) listeners.delete(listener);
              subscriber.isOpen = false;
            },
          };
          return subscriber;
        },
        publish: async (channel: string, message: string) => {
          assert.equal(channel, CHAT_REDIS_CHANNEL);
          published.push(JSON.parse(message) as RealtimeEvent);
          for (const listener of listeners) listener(message);
          return listeners.size;
        },
      }),
      ping: async () => 'PONG',
    },
  };
}

type WireFrame = { type: string; roomId?: string; payload: Record<string, unknown> };

// No ws dependency: handshake and incremental server-frame decoding over a
// loopback TCP socket, including split/coalesced and extended-length frames.
function openSocket(baseUrl: string, cookie: string) {
  const url = new URL(baseUrl);
  assert.equal(url.hostname, '127.0.0.1');
  const socket = createConnection({ host: '127.0.0.1', port: Number(url.port) });
  const key = randomBytes(16).toString('base64');
  const expectedAccept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  const frames: WireFrame[] = [];
  let pending = Buffer.alloc(0);
  let upgraded = false;
  let failure: Error | undefined;
  const waiters = new Set<{
    predicate: (frame: WireFrame) => boolean;
    resolve: (frame: WireFrame) => void;
    reject: (error: Error) => void;
  }>();
  const fail = (error: Error) => {
    failure = error;
    for (const waiter of [...waiters]) waiter.reject(error);
    socket.destroy();
  };
  socket.on('error', fail);
  socket.on('close', () => {
    failure ??= new Error('Realtime socket closed');
    for (const waiter of [...waiters]) waiter.reject(failure);
  });
  socket.once('connect', () => {
    socket.write([
      'GET /api/v1/chats/realtime HTTP/1.1', `Host: 127.0.0.1:${url.port}`,
      'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Version: 13',
      `Sec-WebSocket-Key: ${key}`, `Cookie: ${cookie}`, '', '',
    ].join('\r\n'));
  });
  socket.on('data', (chunk: Buffer) => {
    try {
      pending = Buffer.concat([pending, chunk]);
      if (!upgraded) {
        const end = pending.indexOf('\r\n\r\n');
        if (end < 0) return;
        const header = pending.subarray(0, end).toString('utf8');
        assert.match(header, /^HTTP\/1\.1 101 Switching Protocols\r\n/);
        assert.ok(header.includes(`Sec-WebSocket-Accept: ${expectedAccept}`));
        pending = pending.subarray(end + 4);
        upgraded = true;
      }
      while (pending.length >= 2) {
        assert.equal(pending[0], 0x81, 'Production server emits complete text frames');
        assert.equal(pending[1] & 0x80, 0, 'Server frames must not be masked');
        let length = pending[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (pending.length < 4) return;
          length = pending.readUInt16BE(2); offset = 4;
        } else if (length === 127) {
          if (pending.length < 10) return;
          const extended = pending.readBigUInt64BE(2);
          assert.ok(extended <= 1_048_576n, 'Bounded fixture frame');
          length = Number(extended); offset = 10;
        }
        if (pending.length < offset + length) return;
        const frame = JSON.parse(pending.subarray(offset, offset + length).toString('utf8')) as WireFrame;
        assert.equal(typeof frame.type, 'string');
        frames.push(frame);
        pending = pending.subarray(offset + length);
        for (const waiter of [...waiters]) if (waiter.predicate(frame)) waiter.resolve(frame);
      }
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
  return {
    frames,
    waitFor(predicate: (frame: WireFrame) => boolean, from = 0): Promise<WireFrame> {
      const existing = frames.slice(from).find(predicate);
      if (existing) return Promise.resolve(existing);
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => waiter.reject(new Error('Timed out waiting for a real WebSocket frame')), 5_000);
        const waiter = {
          predicate,
          resolve: (frame: WireFrame) => { clearTimeout(timer); waiters.delete(waiter); resolve(frame); },
          reject: (error: Error) => { clearTimeout(timer); waiters.delete(waiter); reject(error); },
        };
        waiters.add(waiter);
      });
    },
    close: () => new Promise<void>((resolve) => {
      if (socket.closed) { resolve(); return; }
      socket.once('close', resolve);
      socket.destroy();
    }),
  };
}

test('already-open cookie WebSockets recheck persisted chat, notification and source grants per delivery', { timeout: 90_000 }, async (t) => {
  assert.equal(usesIsolatedIntegrationDatabase(), true);
  const databaseUrl = new URL(process.env.DATABASE_URL!);
  assert.ok(['postgres:', 'postgresql:'].includes(databaseUrl.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname));
  assert.equal(databaseUrl.port, '55432');
  assert.match(databaseUrl.searchParams.get('schema') ?? '', /^integration_\d+_\d+$/);
  // Only the main serial integration runner provisions/drops this schema.
  const prisma = new PrismaClient();
  const transport = isolatedPublication();
  let closeApp: (() => Promise<void>) | undefined = undefined;
  const sockets: Array<ReturnType<typeof openSocket>> = [];
  t.after(async () => {
    try {
      await Promise.all(sockets.map((socket) => socket.close()));
      await closeApp?.();
    } finally { await prisma.$disconnect(); }
  });
  // Same AppModule/configureApp path as createTestApp; that helper has no DI
  // override seam and does not attach realtime. Keep both changes local here.
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RedisService).useValue(transport.provider)
    // Metadata-only fixture must not run real StorageService.ensureBucket at
    // AppModule startup or touch another application's object store.
    .overrideProvider(StorageService).useValue({
      getBucketName: () => 'isolated-no-binary',
      uploadObject: () => { throw new Error('Metadata-only realtime fixture cannot upload bytes'); },
      downloadObject: () => { throw new Error('Metadata-only realtime fixture cannot download bytes'); },
      buildObjectUrl: () => { throw new Error('Metadata-only realtime fixture cannot expose storage URLs'); },
    })
    .overrideProvider(FilePreviewService).useValue({})
    .compile();
  const app = moduleRef.createNestApplication();
  closeApp = () => app.close();
  await configureApp(app);
  const realtime = app.get(ChatRealtimeService);
  realtime.attachToServer(app.getHttpServer() as Server);
  await app.listen(0, '127.0.0.1');
  const address = (app.getHttpServer() as Server).address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const marker = `acl-realtime-${randomUUID()}`;
  const template = await prisma.user.findUniqueOrThrow({ where: { login: 'manager1' } });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'manager' } });
  const newUser = (label: string) => prisma.user.create({ data: {
    login: `${marker}-${label}`, fullName: `${marker}-${label}`, passwordHash: template.passwordHash,
    isActive: true, roles: { create: { roleId: role.id } },
  } });
  const actor = await newUser('reader');
  const peer = await newUser('peer');
  const cookie = await loginAndGetCookieHeader({ baseUrl, login: actor.login, password: 'manager123' });
  const peerCookie = await loginAndGetCookieHeader({ baseUrl, login: peer.login, password: 'manager123' });
  const reader = openSocket(baseUrl, cookie); sockets.push(reader);
  const other = openSocket(baseUrl, peerCookie); sockets.push(other);
  assert.equal((await reader.waitFor(frame => frame.type === 'chat.connected')).payload.userId, actor.id);
  assert.equal((await other.waitFor(frame => frame.type === 'chat.connected')).payload.userId, peer.id);
  const newRoom = (label: string, includeActor: boolean) => prisma.chatRoom.create({ data: {
    title: `${marker}-${label}`, roomType: 'group', visibilityType: 'explicit_members', createdByUserId: peer.id,
    participants: { create: [
      { userId: peer.id, roleInRoom: 'admin', joinedAt: new Date('2026-01-01T00:00:00Z') },
      ...(includeActor ? [{ userId: actor.id, roleInRoom: 'member', joinedAt: new Date('2026-01-01T00:00:00Z') }] : []),
    ] },
  } });
  const a = await newRoom('A', true);
  const b = await newRoom('B', true);
  const hiddenRoom = await newRoom('hidden', false);
  const queuedMessages = new Map<string, string>();
  for (const room of [b, hiddenRoom]) {
    const message = await prisma.chatMessage.create({ data: {
      chatRoomId: room.id, authorUserId: peer.id, messageType: 'user', text: `${marker}-queued-${room.id}`,
    } });
    queuedMessages.set(room.id, message.id);
  }
  const newObject = (label: string, creator: string) => prisma.object.create({ data: {
    name: `${marker}-${label}`, address: 'Own disposable schema only', status: 'active', createdByUserId: creator,
  } });
  const sourceA = await newObject('source-A', actor.id);
  const sourceB = await newObject('source-B', actor.id);
  const hiddenSource = await newObject('hidden-source', peer.id);
  // Persisted queued rows; envelope fields exactly match NotificationsService's
  // actual outbox publisher. No notification/outbox publication claim is made.
  const notice = async (entityId: string | null, recipientUserId = actor.id): Promise<NotificationRealtimeEvent> => {
    const row: Notification = await prisma.notification.create({ data: {
      recipientUserId, type: 'acl.realtime.fixture', title: `${marker}-title`, body: `${marker}-private-body`,
      entityType: entityId ? 'object' : null, entityId,
      targetUrl: entityId ? `/objects/${entityId}` : null,
    } });
    return { type: 'notification.created', recipientUserIds: [recipientUserId], payload: {
      id: row.id, type: row.type, title: row.title, body: row.body, entityType: row.entityType,
      entityId: row.entityId, targetUrl: row.targetUrl, readAt: null, createdAt: row.createdAt.toISOString(),
    } };
  };
  const generic = await notice(null);
  const notificationA = await notice(sourceA.id);
  const notificationB = await notice(sourceB.id);
  const hiddenNotification = await notice(hiddenSource.id);
  const foreignNotification = await notice(null, peer.id);
  const publish = async (event: RealtimeEvent) => {
    await realtime.publish(event);
    // Only observe the real subscription queue; never replace clients,
    // canDeliver, users, policy, SQL eligibility, encoding or socket.write.
    await (realtime as unknown as { deliveryQueue: Promise<void> }).deliveryQueue;
  };
  const matches = (event: RealtimeEvent) => (frame: WireFrame) =>
    frame.type === event.type && frame.roomId === ('roomId' in event ? event.roomId : undefined) &&
    JSON.stringify(frame.payload) === JSON.stringify(event.payload);
  const delivered = async (event: RealtimeEvent, socket = reader) => {
    const start = socket.frames.length;
    await publish(event);
    assert.deepEqual((await socket.waitFor(matches(event), start)).payload, event.payload);
  };
  const chatEvent = (roomId: string): ChatRealtimeEvent => {
    const messageId = queuedMessages.get(roomId);
    assert.ok(messageId, 'Queued controls refer to real synthetic messages');
    return { type: 'chat.message_updated', roomId, recipientUserIds: [actor.id], payload: { messageId } };
  };
  const chatBarrier = (): ChatRealtimeEvent => ({
    type: 'chat.room_updated', roomId: b.id, recipientUserIds: [actor.id], payload: { roomId: b.id },
  });
  const suppressed = async (events: RealtimeEvent[], barrier: RealtimeEvent) => {
    const start = reader.frames.length;
    const before = await prisma.notification.findMany({ where: { recipientUserId: { in: [actor.id, peer.id] } }, orderBy: { id: 'asc' } });
    for (const event of events) await publish(event);
    // A later allowed event on this SAME socket is a processing/TCP fence.
    // Absence assertions therefore do not rely on an arbitrary sleep window.
    await delivered(barrier);
    for (const event of events) assert.equal(reader.frames.slice(start).some(frame => hasRealtimeEventIdentity(frame, event)), false, `Suppressed ${event.type} must have no frame/payload, even with altered metadata`);
    assert.deepEqual(await prisma.notification.findMany({ where: { recipientUserId: { in: [actor.id, peer.id] } }, orderBy: { id: 'asc' } }), before);
  };
  const rule = async (actionCode: string, effect: 'allow' | 'deny', selectedIds?: string[]) => {
    const scope = selectedIds ? 'selected' : 'all';
    assert.ok(ACCESS_ACTION_CATALOG.find(action => action.code === actionCode)?.allowedScopes.includes(scope));
    await prisma.$transaction([
      prisma.userAccessRule.upsert({ where: { userId_actionCode: { userId: actor.id, actionCode } },
        create: { userId: actor.id, actionCode, effect, scope, selectedIds: selectedIds ?? [] },
        update: { effect, scope, selectedIds: selectedIds ?? [] },
      }),
      prisma.user.update({ where: { id: actor.id }, data: { accessVersion: { increment: 1 } } }),
    ]);
  };
  const revoke = async (actionCode: string) => {
    await prisma.$transaction([
      prisma.userAccessRule.delete({ where: { userId_actionCode: { userId: actor.id, actionCode } } }),
      prisma.user.update({ where: { id: actor.id }, data: { accessVersion: { increment: 1 } } }),
    ]);
  };
  const request = (path: string, method = 'GET', body?: unknown, auth = cookie) => fetch(`${baseUrl}/api/v1${path}`, {
    method, headers: { Cookie: auth, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = async <T,>(response: Response, status = 200): Promise<T> => {
    const text = await response.text(); assert.equal(response.status, status, text); return JSON.parse(text) as T;
  };
  const producerEvents = async (roomId: string, text: string) => {
    const start = transport.published.length;
    const dto = await json<ChatMessageResponseDto>(await request(`/chats/rooms/${roomId}/messages`, 'POST', { text }, peerCookie), 201);
    const event = transport.published.slice(start).find((entry): entry is ChatRealtimeEvent => entry.type === 'chat.message_created' && entry.roomId === roomId && entry.payload.messageId === dto.id);
    assert.ok(event, 'Actual HTTP producer must publish its message ID through the isolated subscriber');
    assert.deepEqual(event.payload, { messageId: dto.id }, 'Do not inject impossible raw attachment DTOs into chat events');
    return { dto, event };
  };
  const first = await producerEvents(a.id, `${marker}-first`);
  await reader.waitFor(matches(first.event));

  await t.test('chat selected denies, root/read leaves and explicit regrants take effect without reconnecting', async () => {
    for (const action of ['chat.realtime', 'chat.messages.read', 'chat.read', 'chat.access']) {
      await rule(action, 'deny', [a.id]);
      await suppressed([first.event], chatBarrier());
      await rule(action, 'allow', [a.id]);
      const start = reader.frames.length;
      const next = await producerEvents(a.id, `${marker}-${action}-regrant`);
      await reader.waitFor(matches(next.event), start);
      await revoke(action);
      await delivered(next.event); // default retains legacy membership, not a manufactured grant
    }
    await rule('chat.access', 'deny');
    await suppressed([first.event, chatEvent(b.id)], generic);
    await revoke('chat.access');
    await delivered(first.event);
  });

  await t.test('notification realtime/read/root denies suppress the actual persisted metadata; a new notice survives regrant', async () => {
    await delivered(notificationA);
    for (const action of ['notifications.realtime', 'notifications.read', 'notifications.access']) {
      await rule(action, 'deny');
      await suppressed([notificationA, notificationB, generic], chatBarrier());
      await rule(action, 'allow');
      await delivered(await notice(sourceA.id));
      await revoke(action);
      await delivered(notificationA);
    }
  });

  await t.test('queued source metadata is checked again: selected A deny preserves B; root deny preserves only generic', async () => {
    await rule('objects.read', 'deny', [sourceA.id]);
    await suppressed([notificationA], notificationB);
    await rule('objects.read', 'allow', [sourceA.id]);
    await delivered(await notice(sourceA.id));
    await revoke('objects.read');
    await rule('objects.access', 'deny');
    await suppressed([notificationA, notificationB], generic);
    await revoke('objects.access');
    await delivered(notificationA);
  });

  await t.test('foreign recipients and hidden sources/memberships are not manufactured by broad grants', async () => {
    const peerStart = other.frames.length;
    const peerOnlyChat = { ...first.event, recipientUserIds: [peer.id] };
    await suppressed([peerOnlyChat], chatBarrier());
    await other.waitFor(matches(peerOnlyChat), peerStart);
    await rule('notifications.realtime', 'allow');
    // A real event for the peer reaches the peer socket, never the reader.
    const start = reader.frames.length;
    await delivered(foreignNotification, other);
    await delivered(generic);
    assert.equal(reader.frames.slice(start).some(frame => hasRealtimeEventIdentity(frame, foreignNotification)), false);
    // A stale/incorrect recipient envelope still cannot override the stored recipient.
    await suppressed([{ ...foreignNotification, recipientUserIds: [actor.id] }, hiddenNotification], generic);
    await revoke('notifications.realtime');
    await rule('chat.realtime', 'allow');
    await rule('chat.read', 'allow');
    await suppressed([chatEvent(hiddenRoom.id)], chatBarrier());
    await revoke('chat.read'); await revoke('chat.realtime');
    assert.equal(await prisma.chatRoomParticipant.count({ where: { chatRoomId: hiddenRoom.id, userId: actor.id } }), 0);
  });

  await t.test('real ID-only message event remains safe under files.read deny; HTTP must redact nested file metadata', async () => {
    const file = await prisma.file.create({ data: {
      bucket: 'isolated-no-binary', objectKey: `${marker}/never-uploaded`, originalName: `${marker}-private.txt`,
      mimeType: 'text/plain', sizeBytes: 1, uploadedByUserId: peer.id,
      attachments: { create: { entityType: 'chat_message', entityId: first.dto.id, uploadedByUserId: peer.id } },
    } });
    const baseline = await json<ChatMessageResponseDto>(await request(`/chats/messages/${first.dto.id}`));
    assert.deepEqual(baseline.attachments.map(entry => entry.id), [file.id]);
    await rule('files.read', 'deny');
    try {
      const start = reader.frames.length;
      const publicationStart = transport.published.length;
      await json(await request(`/chats/messages/${first.dto.id}`, 'PATCH', { text: `${marker}-updated-with-file` }, peerCookie));
      const actual = transport.published.slice(publicationStart).find((entry): entry is ChatRealtimeEvent => entry.type === 'chat.message_updated' && entry.payload.messageId === first.dto.id);
      assert.ok(actual);
      const frame = await reader.waitFor(matches(actual), start);
      assert.deepEqual(frame.payload, { messageId: first.dto.id });
      assert.equal(JSON.stringify(frame).includes(file.originalName), false);
      assert.equal(JSON.stringify(frame).includes(`/files/${file.id}`), false);
      const fileResponse = await request(`/files/${file.id}`);
      assert.equal(fileResponse.status, 403, await fileResponse.text());
      const single = await json<ChatMessageResponseDto>(await request(`/chats/messages/${first.dto.id}`));
      const list = await json<ChatMessageResponseDto[]>(await request(`/chats/rooms/${a.id}/messages`));
      const listed = list.find(entry => entry.id === first.dto.id);
      assert.ok(listed);
      // Regression assertions, not a claim that the existing mapper passes:
      // direct file denial must also remove names/object keys/URLs in chat DTOs.
      assert.deepEqual(single.attachments, [], 'Direct chat GET must honor current files.read');
      assert.deepEqual(listed.attachments, [], 'Room message listing must honor current files.read');
      assert.equal(JSON.stringify([single, listed]).includes(file.originalName), false);
    } finally { await revoke('files.read'); }
  });

  assert.equal(reader.frames.filter(frame => frame.type === 'chat.connected').length, 1, 'All checks use the original socket/cookie, without reconnect or login');
  assert.deepEqual(await prisma.userRole.findMany({ where: { userId: actor.id }, select: { roleId: true } }), [{ roleId: role.id }]);
  assert.equal(await prisma.userAccessRule.count({ where: { userId: actor.id } }), 0);
});
